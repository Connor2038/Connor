import { spawn } from 'node:child_process';
import { cp, mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

export interface ScriptTool {
  name: string;
  command: string[];
  timeout_ms: number;
  parameters: Record<string, unknown>;
}

const outputLimit = 256 * 1024;

function portableEnvironment() {
  const environment = { ...process.env };
  delete environment.VIVIX_API_KEY;
  return environment;
}

export function validateToolArguments(schema: Record<string, unknown>, value: unknown) {
  if (!value || typeof value !== 'object' || Array.isArray(value))
    throw new Error('Tool arguments must be an object.');
  const object = value as Record<string, unknown>;
  for (const name of (schema.required as string[] | undefined) ?? [])
    if (!(name in object)) throw new Error(`Tool argument ${name} is required.`);
  if (schema.additionalProperties === false) {
    const allowed = new Set(Object.keys((schema.properties as object | undefined) ?? {}));
    for (const name of Object.keys(object))
      if (!allowed.has(name)) throw new Error(`Tool argument ${name} is not allowed.`);
  }
  const properties = (schema.properties ?? {}) as Record<string, { type?: string }>;
  for (const [name, item] of Object.entries(object)) {
    const expected = properties[name]?.type;
    if (expected === 'array' ? !Array.isArray(item) : expected && typeof item !== expected)
      throw new Error(`Tool argument ${name} must be ${expected}.`);
  }
}

export async function executeScriptTool(
  tool: ScriptTool,
  request: { tool_name: string; call_id: string; arguments: Record<string, unknown> },
  characterRoot = join(process.cwd(), 'character'),
) {
  validateToolArguments(tool.parameters, request.arguments);
  const workspace = await mkdtemp(join(tmpdir(), 'vivix-tool-'));
  try {
    await cp(join(characterRoot, 'tools'), join(workspace, 'tools'), { recursive: true });
    return await new Promise<unknown>((resolve, reject) => {
      const child = spawn(tool.command[0], tool.command.slice(1), {
        cwd: workspace,
        detached: process.platform !== 'win32',
        env: portableEnvironment(),
        stdio: ['pipe', 'pipe', 'pipe'],
      });
      const stdout: Buffer[] = [];
      const stderr: Buffer[] = [];
      let size = 0;
      let settled = false;
      const stop = () => {
        if (child.pid && process.platform !== 'win32') {
          try {
            process.kill(-child.pid, 'SIGKILL');
          } catch {}
        } else child.kill('SIGKILL');
      };
      const finish = (error?: Error, value?: unknown) => {
        if (settled) return;
        settled = true;
        clearTimeout(timer);
        error ? reject(error) : resolve(value);
      };
      const timer = setTimeout(() => {
        stop();
        finish(new Error(`Tool ${tool.name} exceeded ${tool.timeout_ms}ms.`));
      }, tool.timeout_ms);
      const collect = (target: Buffer[]) => (chunk: Buffer) => {
        size += chunk.length;
        if (size > outputLimit) {
          stop();
          finish(new Error(`Tool ${tool.name} exceeded the output limit.`));
        } else target.push(chunk);
      };
      child.stdout.on('data', collect(stdout));
      child.stderr.on('data', collect(stderr));
      child.on('error', error => finish(error));
      child.on('close', code => {
        if (settled) return;
        if (code !== 0)
          return finish(new Error(`Tool ${tool.name} exited ${code}: ${Buffer.concat(stderr).toString().trim()}`));
        try {
          finish(undefined, JSON.parse(Buffer.concat(stdout).toString('utf8').trim()));
        } catch {
          finish(new Error(`Tool ${tool.name} must write exactly one JSON value to stdout.`));
        }
      });
      child.stdin.end(JSON.stringify(request));
    });
  } finally {
    await rm(workspace, { recursive: true, force: true });
  }
}
