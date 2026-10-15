import type { DemoState } from './demo-session';
import type { UISession, UISessionSnapshot } from './custom-ui';

const initial: UISessionSnapshot = {
  revision: 0,
  run_id: null,
  active_run_id: null,
  phase: 'idle',
  response_active: false,
  speaking: false,
  user_speaking: false,
  tool_observations: [],
  tool_update_type: null,
};

export class RuntimeUISession implements UISession {
  private snapshot = initial;
  private listeners = new Set<() => void>();
  private updates = new Set<(update: { type: 'runtime'; snapshot: UISessionSnapshot }) => void>();
  getSnapshot = () => this.snapshot;
  subscribe = (listener: () => void) => {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  };
  subscribeUpdates = (listener: (update: { type: 'runtime'; snapshot: UISessionSnapshot }) => void) => {
    this.updates.add(listener);
    return () => this.updates.delete(listener);
  };
  update(state: DemoState) {
    const phase =
      state.status === 'stopping' ? 'closing'
      : state.status === 'error' ? 'failed'
      : state.status;
    this.snapshot = {
      ...this.snapshot,
      revision: this.snapshot.revision + 1,
      run_id: state.sessionId || null,
      active_run_id: state.sessionId || null,
      phase,
      response_active: state.caption.length > 0,
      speaking: state.caption.length > 0,
      user_speaking: state.microphone && state.transcript.length > 0,
    };
    this.listeners.forEach(listener => listener());
    this.updates.forEach(listener => listener({ type: 'runtime', snapshot: this.snapshot }));
  }
}
