import 'server-only';
export class ApiError extends Error {
  constructor(
    readonly code: string,
    message: string,
    readonly status = 500,
  ) {
    super(message);
  }
}
export function apiKey(): string {
  const key = process.env.VIVIX_API_KEY?.trim();
  if (!key || key === 'your_api_key_here')
    throw new ApiError(
      'MISSING_API_KEY',
      'Set VIVIX_API_KEY in .env and restart the development server.',
      400,
    );
  return key;
}
export function redact(message: string): string {
  const key = process.env.VIVIX_API_KEY;
  return (key ? message.split(key).join('[redacted]') : message)
    .replace(/(?:vivix_|Bearer )[A-Za-z0-9_.-]+/g, '[redacted]')
    .slice(0, 700);
}
export async function vivixRequest(path: string, body?: unknown): Promise<Record<string, unknown>> {
  const key = apiKey();
  let response: Response;
  try {
    response = await fetch(`https://api.vivix.ai/v1/realtime-avatar/sessions${path}`, {
      method: body === undefined ? 'GET' : 'POST',
      headers: { Authorization: `Bearer ${key}`, 'Content-Type': 'application/json' },
      body: body === undefined ? undefined : JSON.stringify(body),
      cache: 'no-store',
      signal: AbortSignal.timeout(120_000),
    });
  } catch {
    throw new ApiError(
      'CONNECTION_FAILED',
      'Vivix could not be reached. Check your connection and retry.',
      502,
    );
  }
  let envelope: Record<string, unknown>;
  try {
    envelope = await response.json();
  } catch {
    throw new ApiError('INVALID_RESPONSE', 'Vivix returned an invalid response.', 502);
  }
  if (!response.ok || (envelope.code !== undefined && envelope.code !== 0)) {
    const data = envelope.data as Record<string, unknown> | undefined;
    const detail = data?.detail ?? envelope.message ?? 'Request rejected.';
    const reason = redact(typeof detail === 'string' ? detail : JSON.stringify(detail));
    const hint =
      response.status === 401 || /invalid.*api.?key/i.test(reason)
        ? 'Check your API key.'
        : response.status === 402
          ? 'Check your balance.'
          : response.status === 403
            ? 'Check Avatar permissions for this key.'
            : response.status === 429
              ? 'End any other session using this key, wait for capacity to become available, then retry.'
              : 'Check the template configuration and try again.';
    throw new ApiError(
      String(envelope.code ?? response.status),
      `${reason} ${hint}`,
      response.ok ? 502 : response.status,
    );
  }
  return (envelope.data ?? envelope) as Record<string, unknown>;
}
export function errorResponse(error: unknown): Response {
  const known = error instanceof ApiError;
  return Response.json(
    {
      error: {
        code: known ? error.code : 'INTERNAL_ERROR',
        message: known
          ? redact(error.message)
          : 'The request could not be completed. Retry or restart the demo.',
      },
    },
    { status: known ? error.status : 500, headers: { 'Cache-Control': 'no-store' } },
  );
}
