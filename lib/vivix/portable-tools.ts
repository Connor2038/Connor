export interface PortableToolCall {
  sessionId: string;
  callId: string;
  name: string;
  arguments: Record<string, unknown>;
}

export async function executePortableTool(call: PortableToolCall) {
  const response = await fetch('/api/vivix/tools/execute', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      session_id: call.sessionId,
      call_id: call.callId,
      tool_name: call.name,
      arguments: call.arguments,
    }),
  });
  const result = await response.json();
  if (!response.ok) throw new Error(result.error?.message ?? 'The tool call failed.');
  return result.output;
}
