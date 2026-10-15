import 'server-only';
import { randomUUID } from 'node:crypto';

import runtime from '@/generated/runtime.json';
import session from '@/generated/session.json';
import type { TemplateConfig } from './types';

export const config = runtime as unknown as TemplateConfig;

export async function sessionRequest() {
  return { idempotency_key: randomUUID(), ...session };
}
