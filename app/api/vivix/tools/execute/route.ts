import { ApiError, errorResponse } from '@/lib/vivix/api';
import { requireSession } from '@/lib/vivix/session-owner';
import { executeScriptTool, type ScriptTool } from '@/lib/vivix/script-tools';
import { searchKnowledge, type KnowledgeChunk } from '@/lib/vivix/knowledge';
import registry from '@/generated/tools.json';
import knowledge from '@/generated/knowledge.json';

export const runtime = 'nodejs';

const shared = globalThis as typeof globalThis & {
  cloneToolCalls?: Map<string, Promise<unknown>>;
};
const calls = (shared.cloneToolCalls ??= new Map());

function scriptTools() {
  return ((registry as { runtime?: ScriptTool[] }).runtime ?? []);
}

export async function POST(request: Request) {
  try {
    const session = await requireSession();
    const body = (await request.json().catch(() => null)) as Record<string, unknown> | null;
    if (
      !body ||
      body.session_id !== session ||
      typeof body.call_id !== 'string' ||
      !/^[A-Za-z0-9_.:-]{1,160}$/.test(body.call_id) ||
      typeof body.tool_name !== 'string' ||
      !body.arguments ||
      typeof body.arguments !== 'object' ||
      Array.isArray(body.arguments)
    )
      throw new ApiError('INVALID_TOOL_CALL', 'The tool call is invalid or belongs to another session.', 400);
    const tool = scriptTools().find(candidate => candidate.name === body.tool_name);
    const isKnowledge = body.tool_name === 'vivix.knowledge.search';
    if (!tool && !isKnowledge)
      throw new ApiError('UNKNOWN_TOOL', `Tool ${body.tool_name} is not executable here.`, 404);
    const key = `${session}:${body.call_id}`;
    let result = calls.get(key);
    if (!result) {
      const arguments_ = body.arguments as Record<string, unknown>;
      result = isKnowledge
        ? Promise.resolve().then(() => {
            if (typeof arguments_.query !== 'string')
              throw new Error('Knowledge query must be a string.');
            return searchKnowledge(
              knowledge as KnowledgeChunk[],
              arguments_.query,
              arguments_.limit === undefined ? 4 : Number(arguments_.limit),
            );
          })
        : executeScriptTool(tool!, {
            tool_name: body.tool_name,
            call_id: body.call_id,
            arguments: arguments_,
          });
      calls.set(key, result);
      void result.finally(() => setTimeout(() => calls.delete(key), 300_000));
    }
    try {
      return Response.json(
        { output: await result },
        { headers: { 'Cache-Control': 'no-store' } },
      );
    } catch (error) {
      throw new ApiError(
        'TOOL_EXECUTION_FAILED',
        error instanceof Error ? error.message : 'The tool failed.',
        422,
      );
    }
  } catch (error) {
    return errorResponse(error);
  }
}
