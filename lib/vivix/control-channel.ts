import type { ControlEvent } from './types';
type Predicate = (event: ControlEvent) => boolean;
interface Waiter {
  predicate: Predicate;
  resolve: (event: ControlEvent) => void;
  reject: (error: Error) => void;
  dispose: () => void;
}
export class ControlChannel {
  private socket: WebSocket | null = null;
  private listeners = new Set<(event: ControlEvent) => void>();
  private waiters = new Set<Waiter>();
  private history: ControlEvent[] = [];
  private stopped = false;
  constructor(private readonly onDisconnect: (error: Error) => void) {}
  async connect(url: string, secret: string): Promise<void> {
    const endpoint = new URL(url);
    endpoint.searchParams.set('token', secret);
    this.stopped = false;
    await new Promise<void>((resolve, reject) => {
      const ws = new WebSocket(endpoint);
      this.socket = ws;
      const timer = setTimeout(() => {
        ws.close();
        reject(new Error('Control connection timed out.'));
      }, 20_000);
      ws.onopen = () => {
        clearTimeout(timer);
        resolve();
      };
      ws.onerror = () => {
        clearTimeout(timer);
        reject(new Error('Control connection failed.'));
      };
      ws.onclose = () => {
        clearTimeout(timer);
        if (this.socket !== ws) return;
        const error = new Error('Control connection closed. End this session and start again.');
        this.clear(error);
        if (!this.stopped) this.onDisconnect(error);
        reject(error);
      };
      ws.onmessage = ({ data }) => {
        if (this.socket !== ws) return;
        let event: ControlEvent;
        try {
          event = JSON.parse(String(data));
        } catch {
          return;
        }
        if (!event.type) return;
        this.history.push(event);
        if (this.history.length > 300) this.history.shift();
        for (const waiter of [...this.waiters])
          if (waiter.predicate(event)) {
            waiter.dispose();
            waiter.resolve(event);
          }
        for (const listener of this.listeners) listener(event);
      };
    });
  }
  subscribe(listener: (event: ControlEvent) => void) {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }
  send(
    type: string,
    payload: Record<string, unknown> = {},
    eventId = `evt_${crypto.randomUUID()}`,
  ): string {
    if (this.socket?.readyState !== WebSocket.OPEN)
      throw new Error('Live controls are disconnected.');
    this.socket.send(JSON.stringify({ type, event_id: eventId, ...payload }));
    return eventId;
  }
  trySend(
    type: string,
    payload: Record<string, unknown> = {},
    eventId = `evt_${crypto.randomUUID()}`,
  ): string | null {
    if (this.socket?.readyState !== WebSocket.OPEN) return null;
    this.socket.send(JSON.stringify({ type, event_id: eventId, ...payload }));
    return eventId;
  }
  wait(
    predicate: Predicate,
    signal?: AbortSignal,
    timeout = 120_000,
    includeHistory = false,
  ): Promise<ControlEvent> {
    if (signal?.aborted)
      return Promise.reject(new DOMException('Operation cancelled.', 'AbortError'));
    const found = includeHistory ? this.history.find(predicate) : undefined;
    if (found) return Promise.resolve(found);
    return new Promise((resolve, reject) => {
      const abort = () => {
        waiter.dispose();
        reject(new DOMException('Operation cancelled.', 'AbortError'));
      };
      const timer = setTimeout(() => {
        waiter.dispose();
        reject(new Error('Timed out waiting for a Vivix event.'));
      }, timeout);
      const waiter: Waiter = {
        predicate,
        resolve,
        reject,
        dispose: () => {
          clearTimeout(timer);
          signal?.removeEventListener('abort', abort);
          this.waiters.delete(waiter);
        },
      };
      this.waiters.add(waiter);
      signal?.addEventListener('abort', abort, { once: true });
    });
  }
  async command(
    type: string,
    payload: Record<string, unknown>,
    predicate: Predicate,
    signal?: AbortSignal,
    eventId = `evt_${crypto.randomUUID()}`,
  ): Promise<ControlEvent> {
    const scope = new AbortController();
    const combined = signal ? AbortSignal.any([signal, scope.signal]) : scope.signal;
    const pending = this.wait(
      (event) => predicate(event) || (event.type === 'error' && event.error?.event_id === eventId),
      combined,
    );
    try {
      this.send(type, payload, eventId);
      const event = await pending;
      if (event.type === 'error')
        throw new Error(event.error?.message ?? 'Vivix rejected this command.');
      return event;
    } finally {
      scope.abort();
      void pending.catch(() => {});
    }
  }
  close() {
    this.stopped = true;
    this.socket?.close();
    this.socket = null;
    this.clear(new Error('Session ended.'));
    this.listeners.clear();
    this.history = [];
  }
  private clear(error: Error) {
    for (const waiter of [...this.waiters]) {
      waiter.dispose();
      waiter.reject(error);
    }
  }
}
