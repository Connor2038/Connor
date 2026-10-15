import { errorResponse, vivixRequest, ApiError } from '@/lib/vivix/api';
import { sessionRequest } from '@/lib/vivix/session-config';
import { ownedSession, requireSession, saveSession } from '@/lib/vivix/session-owner';
export const runtime = 'nodejs';
const shared = globalThis as typeof globalThis & { studioCreating?: boolean };
function browserSession(session: Record<string, unknown>) {
  return {
    session_id: session.session_id,
    status: session.status,
    control: session.control,
    delivery: session.delivery,
    expires_at: session.expires_at,
  };
}
export async function POST(request: Request) {
  try {
    if (await ownedSession())
      throw new ApiError(
        'SESSION_EXISTS',
        'End the existing session before starting another.',
        409,
      );
    const body = await request.json().catch(() => null);
    if (!body || typeof body !== 'object' || Array.isArray(body))
      throw new ApiError('INVALID_REQUEST', 'Invalid session request.', 400);
    if (shared.studioCreating)
      throw new ApiError(
        'SESSION_STARTING',
        'A session is already starting. Wait for it to finish.',
        409,
      );
    shared.studioCreating = true;
    let session: Record<string, unknown>;
    try {
      session = await vivixRequest('', await sessionRequest());
    } finally {
      shared.studioCreating = false;
    }
    if (typeof session.session_id !== 'string')
      throw new ApiError('INVALID_RESPONSE', 'Vivix did not return a session ID.', 502);
    await saveSession(session.session_id);
    return Response.json(browserSession(session), { headers: { 'Cache-Control': 'no-store' } });
  } catch (error) {
    return errorResponse(error);
  }
}
export async function GET() {
  try {
    return Response.json(
      browserSession(await vivixRequest('/' + encodeURIComponent(await requireSession()))),
      { headers: { 'Cache-Control': 'no-store' } },
    );
  } catch (error) {
    return errorResponse(error);
  }
}
