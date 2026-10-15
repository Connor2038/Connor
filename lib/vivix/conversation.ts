import type { ControlEvent } from './types';

export type MessageStatus = 'streaming' | 'completed' | 'interrupted' | 'failed';
export interface ConversationTool {
  id: string;
  itemId?: string;
  name: string;
  arguments: string;
  output?: string;
  status: 'pending' | 'running' | 'completed' | 'interrupted' | 'failed';
}
export interface ConversationMessage {
  id: string;
  role: 'user' | 'assistant';
  text: string;
  status: MessageStatus;
  tools: ConversationTool[];
}

/** Display history only: never schedules responses or changes playback. */
export class Conversation {
  private messages: ConversationMessage[] = [];
  private seen = new Set<string>();
  private terminal = new Set<string>();
  private textParts = new Map<string, Map<string, { text: string; done: boolean }>>();
  private audioId = '';
  private asrPartials = new Map<string, { previous: string; snapshot: boolean }>();
  private serial = 0;
  constructor(private changed: (messages: ConversationMessage[]) => void) {}

  private message(id: string, role: ConversationMessage['role']) {
    let message = this.messages.find((entry) => entry.id === id);
    if (!message) {
      message = { id, role, text: '', status: 'streaming', tools: [] };
      this.messages.push(message);
    }
    return message;
  }
  private emit() {
    this.changed(
      this.messages.map((entry) => ({ ...entry, tools: entry.tools.map((tool) => ({ ...tool })) })),
    );
  }
  user(id: string, text: string, status: MessageStatus = 'completed') {
    Object.assign(this.message(id, 'user'), { text, status });
    this.emit();
  }
  toolResult(callId: string, status: ConversationTool['status'], output?: string) {
    for (const message of this.messages) {
      const tool = message.tools.find((item) => item.id === callId);
      if (tool) {
        Object.assign(tool, { status, ...(output === undefined ? {} : { output }) });
        this.emit();
        return;
      }
    }
  }
  handle(event: ControlEvent) {
    if (event.event_id && this.seen.has(event.event_id)) return;
    if (event.event_id) this.seen.add(event.event_id);
    const type = event.type;
    const responseId = event.response_id ?? event.response?.id;
    if (type === 'input_audio.speech_started') {
      this.audioId = event.item_id ?? `audio-${++this.serial}`;
      this.message(this.audioId, 'user');
    } else if (type.startsWith('conversation.item.input_audio_transcription.')) {
      const id = event.item_id ?? (this.audioId ||= `audio-${++this.serial}`);
      const message = this.message(id, 'user');
      if (type.endsWith('.delta') && message.status === 'streaming') {
        const delta = event.delta ?? '';
        // Deployed ASR can send a revised hypothesis as well as trimmed word deltas.
        const normalize = (text: string) =>
          text
            .toLowerCase()
            .replace(/[^\p{L}\p{N}]+/gu, ' ')
            .trim();
        const partial = this.asrPartials.get(id) ?? { previous: '', snapshot: false };
        const next = normalize(delta);
        // A growing copy of the previous hypothesis identifies snapshot-style ASR.
        if (
          partial.previous &&
          next.length > partial.previous.length &&
          next.startsWith(partial.previous)
        )
          partial.snapshot = true;
        message.text =
          partial.snapshot || !message.text
            ? delta
            : message.text +
              (/[a-z0-9]$/i.test(message.text) && /^[a-z0-9]/i.test(delta) ? ' ' : '') +
              delta;
        partial.previous = next;
        this.asrPartials.set(id, partial);
      } else if (type.endsWith('.completed')) {
        message.text = event.transcript ?? event.item?.content?.[0]?.transcript ?? message.text;
        message.status = 'completed';
      } else if (type.endsWith('.failed')) message.status = 'failed';
    } else if (type === 'conversation.item.created' && event.item?.role === 'user') {
      const text =
        event.item.content?.map((part) => part.text ?? part.transcript ?? '').join('') ?? '';
      if (text && event.item.id)
        Object.assign(this.message(event.item.id, 'user'), { text, status: 'completed' });
    } else if (
      type === 'conversation.item.created' &&
      event.item?.type === 'function_call_output'
    ) {
      if (event.item.call_id) this.toolResult(event.item.call_id, 'running', event.item.output);
      return;
    } else if (responseId && type.startsWith('response.')) {
      const message = this.message(responseId, 'assistant');
      if (type === 'response.output_text.delta' || type === 'response.output_text.done') {
        const parts =
          this.textParts.get(responseId) ?? new Map<string, { text: string; done: boolean }>();
        this.textParts.set(responseId, parts);
        const key = `${event.output_index ?? 0}:${event.content_index ?? 0}`;
        const part = parts.get(key) ?? { text: '', done: false };
        if (type.endsWith('.done')) {
          part.text = event.text ?? part.text;
          part.done = true;
        } else if (!part.done && !this.terminal.has(responseId)) part.text += event.delta ?? '';
        parts.set(key, part);
        message.text = [...parts.values()].map((entry) => entry.text).join('\n\n');
        if (!this.terminal.has(responseId))
          message.status = type.endsWith('.done') ? 'completed' : 'streaming';
      }
      if (
        (type === 'response.output_item.added' || type === 'response.output_item.done') &&
        event.item?.type === 'function_call'
      ) {
        const item = event.item;
        const id = item.call_id ?? item.id;
        if (id) {
          let tool = message.tools.find((entry) => entry.id === id);
          if (!tool) {
            tool = { id, name: item.name ?? 'Tool', arguments: '', status: 'pending' };
            message.tools.push(tool);
          }
          tool.itemId = item.id ?? tool.itemId;
          tool.name = item.name ?? tool.name;
          tool.arguments = item.arguments ?? tool.arguments;
        }
      }
      if (type.startsWith('response.function_call_arguments.')) {
        const tool = message.tools.find(
          (entry) =>
            entry.id === (event.call_id ?? event.item_id) ||
            (entry.itemId === event.item_id && !!event.item_id),
        );
        if (tool)
          tool.arguments = type.endsWith('.done')
            ? (event.arguments ?? tool.arguments)
            : tool.arguments + (event.delta ?? '');
      }
      if (type === 'response.done') {
        this.terminal.add(responseId);
        const status = event.response?.status ?? event.status;
        if (status !== 'completed') {
          for (const tool of message.tools)
            if (tool.status === 'pending' || tool.status === 'running') tool.status = 'interrupted';
        }
        message.status =
          status === 'completed' ? 'completed' : status === 'cancelled' ? 'interrupted' : 'failed';
      }
      if (type === 'response.render.stopped' && event.status && event.status !== 'completed')
        message.status = 'interrupted';
    } else return;
    this.emit();
  }
  finish() {
    for (const message of this.messages) {
      if (message.status === 'streaming') message.status = 'interrupted';
      for (const tool of message.tools)
        if (tool.status === 'running' || tool.status === 'pending') tool.status = 'interrupted';
    }
    this.emit();
  }
  reset() {
    this.messages = [];
    this.seen.clear();
    this.terminal.clear();
    this.textParts.clear();
    this.asrPartials.clear();
    this.audioId = '';
    this.serial = 0;
    this.emit();
  }
}
