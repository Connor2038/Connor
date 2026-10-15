export type JSONValue = null | boolean | number | string | JSONValue[] | { [key: string]: JSONValue };
type ComponentType<Props> = (props: Props) => unknown;
export interface UIAvatarProps { style?: Record<string, string | number | undefined>; className?: string; mattingRegion?: { x: number; y: number; w: number; h: number; feather?: number } }
export interface UIAction { name: string; description: string; parameters: Record<string, unknown> }
export interface UICatalog { version: string; actions: UIAction[] }
export interface UIState {
  get(key: string): JSONValue | undefined;
  set(key: string, value: JSONValue): void;
  subscribe(listener: () => void): () => void;
}
export interface UIBridge {
  registerActions(actions: Record<string, Omit<UIAction, 'name'> & { handler: (args: Record<string, unknown>) => JSONValue | Promise<JSONValue> }>): () => void;
  emitEvent(event: Record<string, unknown>): boolean;
}
export interface UISessionSnapshot {
  revision: number;
  run_id: string | null;
  active_run_id: string | null;
  phase: 'idle' | 'starting' | 'live' | 'closing' | 'failed' | 'close_failed';
  response_active: boolean;
  speaking: boolean;
  user_speaking: boolean;
  tool_observations: readonly unknown[];
  tool_update_type: null;
}
export interface UISession {
  getSnapshot(): UISessionSnapshot;
  subscribe(listener: () => void): () => void;
  subscribeUpdates(listener: (update: { type: 'runtime'; snapshot: UISessionSnapshot }) => void): () => void;
}
export interface UIProps { Avatar: ComponentType<UIAvatarProps>; bridge: UIBridge; session: UISession; state: UIState }

function jsonCopy<T>(value: T): T {
  const encoded = JSON.stringify(value);
  if (encoded === undefined || new TextEncoder().encode(encoded).byteLength > 1 << 20)
    throw new Error('UI value is not bounded JSON.');
  return JSON.parse(encoded) as T;
}

export class MemoryUIState implements UIState {
  private values = new Map<string, JSONValue>();
  private listeners = new Set<() => void>();
  get = (key: string) => this.values.get(key);
  set = (key: string, value: JSONValue) => {
    if (!/^[A-Za-z0-9_.:-]{1,160}$/.test(key)) throw new Error('Invalid UI state key.');
    this.values.set(key, jsonCopy(value));
    this.listeners.forEach(listener => listener());
  };
  subscribe = (listener: () => void) => {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  };
}

function valid(schema: Record<string, any>, value: unknown): boolean {
  if (schema.enum && !schema.enum.some((candidate: unknown) => Object.is(candidate, value))) return false;
  if (schema.type === 'object') {
    if (!value || typeof value !== 'object' || Array.isArray(value)) return false;
    const object = value as Record<string, unknown>;
    if ((schema.required ?? []).some((key: string) => !(key in object))) return false;
    if (schema.additionalProperties === false && Object.keys(object).some(key => !(key in (schema.properties ?? {})))) return false;
    return Object.entries(object).every(([key, child]) => !schema.properties?.[key] || valid(schema.properties[key], child));
  }
  if (schema.type === 'array') return Array.isArray(value) && value.every(item => !schema.items || valid(schema.items, item));
  if (schema.type === 'integer' && !Number.isInteger(value)) return false;
  if (schema.type && schema.type !== 'integer' && typeof value !== schema.type) return false;
  if (typeof value === 'number' && ((schema.minimum !== undefined && value < schema.minimum) || (schema.maximum !== undefined && value > schema.maximum))) return false;
  if (typeof value === 'string' && ((schema.minLength !== undefined && value.length < schema.minLength) || (schema.maxLength !== undefined && value.length > schema.maxLength))) return false;
  return true;
}

type Registration = Parameters<UIBridge['registerActions']>[0][string];
export class ActionRegistry {
  private actions = new Map<string, { owner: symbol; declaration: Registration }>();
  constructor(private onChange: (catalog: UICatalog) => void) {}
  registerActions: UIBridge['registerActions'] = registrations => {
    const owner = Symbol();
    const prepared = Object.entries(registrations);
    for (const [name, declaration] of prepared) {
      if (!/^[A-Za-z][A-Za-z0-9_.-]{0,127}$/.test(name) || this.actions.has(name))
        throw new Error(`Invalid or duplicate UI action: ${name}`);
      if (!declaration.description?.trim() || declaration.parameters?.type !== 'object' || typeof declaration.handler !== 'function')
        throw new Error(`Invalid UI action declaration: ${name}`);
      jsonCopy(declaration.parameters);
    }
    if (this.actions.size + prepared.length > 128) throw new Error('UI action catalog exceeds limit.');
    for (const [name, declaration] of prepared) this.actions.set(name, { owner, declaration });
    this.changed();
    return () => {
      for (const [name] of prepared) if (this.actions.get(name)?.owner === owner) this.actions.delete(name);
      this.changed();
    };
  };
  private changed() {
    const actions = [...this.actions].map(([name, { declaration }]) => ({
      name, description: declaration.description, parameters: declaration.parameters,
    })).sort((left, right) => left.name.localeCompare(right.name));
    const catalog = { version: 'folder-build', actions };
    if (new TextEncoder().encode(JSON.stringify(catalog)).byteLength > 128 << 10)
      throw new Error('UI action catalog exceeds limit.');
    queueMicrotask(() => this.onChange(catalog));
  }
  async invoke(call: { action: string; arguments: Record<string, unknown> }): Promise<JSONValue> {
    const fail = (code: string, message: string): JSONValue => ({ error: { code, message } });
    const action = this.actions.get(call.action);
    if (!action) return fail('ui_action_unknown', 'UI action is not registered.');
    if (!valid(action.declaration.parameters, call.arguments))
      return fail('ui_arguments_invalid', 'UI action arguments do not match the declared schema.');
    let timer: ReturnType<typeof setTimeout>;
    try {
      return await Promise.race([
        Promise.resolve(action.declaration.handler(jsonCopy(call.arguments))).then(jsonCopy),
        new Promise<JSONValue>(resolve => {
          timer = setTimeout(() => resolve(fail('ui_call_timeout', 'UI action exceeded 15 seconds.')), 15_000);
        }),
      ]);
    } catch (error) {
      return fail('ui_action_failed', error instanceof Error ? error.message : String(error));
    } finally {
      clearTimeout(timer!);
    }
  }
}
