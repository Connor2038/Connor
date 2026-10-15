import type { ControlEvent } from './types';

export interface LiveCaption {
  speaker: 'user' | 'avatar';
  text: string;
  streaming: boolean;
}

/** Text events follow published audio, not the browser's playout clock. */
export class Captions {
  private responseId: string | null = null;
  private text = '';
  private userText = '';
  private timer: ReturnType<typeof setTimeout> | null = null;
  private retired = new Set<string>();
  constructor(private changed: (caption: LiveCaption | null) => void) {}

  private show(speaker: LiveCaption['speaker'], text: string, streaming: boolean) {
    this.changed(text ? { speaker, text, streaming } : null);
  }

  private scheduleClear(delay: number) {
    if (this.timer) clearTimeout(this.timer);
    this.timer = setTimeout(() => this.clear(), delay);
  }

  handle(event: ControlEvent) {
    if (event.type === 'conversation.item.input_audio_transcription.delta') {
      if (this.timer) clearTimeout(this.timer);
      this.userText += event.delta ?? event.text ?? '';
      this.show('user', this.userText, true);
      return;
    }
    if (event.type === 'conversation.item.input_audio_transcription.completed') {
      this.userText = event.transcript ?? event.text ?? this.userText;
      this.show('user', this.userText, false);
      this.scheduleClear(1200);
      return;
    }
    const id = event.response_id ?? event.response?.id;
    if (!id || this.retired.has(id)) return;
    if (event.type === 'response.created') {
      this.clear();
      this.responseId = id;
    }
    if (
      event.type === 'response.output_text.delta' ||
      event.type === 'response.output_text.done' ||
      event.type === 'response.text.delta' ||
      event.type === 'response.text.done'
    ) {
      // Openings publish text without a public response.created event.
      if (!this.responseId) this.responseId = id;
      if (id !== this.responseId) return;
      this.text =
        event.type.endsWith('.delta')
          ? this.text + (event.delta ?? '')
          : (event.text ?? this.text);
      this.show('avatar', this.text, event.type.endsWith('.delta'));
    }
    if (id !== this.responseId) return;
    if (
      event.type === 'response.output_text.done' ||
      event.type === 'response.text.done' ||
      event.type === 'response.render.stopped' ||
      event.type === 'response.done'
    ) {
      const status = event.response?.status ?? event.status;
      if (status && status !== 'completed') {
        this.clear();
        return;
      }
      // Brief reading/RTC grace, including openings that have no response.done.
      // This timeout hides text only; it never advances scripts or certifies playout.
      if (!this.timer) this.scheduleClear(1500);
    }
  }
  discard(id: string) {
    this.retired.add(id);
    if (this.retired.size > 100) this.retired.delete(this.retired.values().next().value!);
  }
  clear() {
    if (this.timer) clearTimeout(this.timer);
    this.timer = null;
    if (this.responseId) this.discard(this.responseId);
    this.responseId = null;
    this.text = '';
    this.userText = '';
    this.changed(null);
  }
  reset() {
    this.clear();
    this.retired.clear();
  }
}
