import { errorResponse, vivixRequest, ApiError } from '@/lib/vivix/api';
import { requireSession, clearSession } from '@/lib/vivix/session-owner';
export async function POST() {
  try {
    const session = await vivixRequest('/' + encodeURIComponent(await requireSession()));
    if (!['closed', 'expired', 'failed'].includes(String(session.status)))
      throw new ApiError('SESSION_ACTIVE', 'The session is still closing. Retry in a moment.', 409);
    await clearSession();
    return Response.json({ status: 'closed' });
  } catch (error) {
    return errorResponse(error);
  }
}
