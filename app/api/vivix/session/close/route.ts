import { errorResponse, vivixRequest } from '@/lib/vivix/api';
import { requireSession, clearSession } from '@/lib/vivix/session-owner';
export const runtime = 'nodejs';
export async function POST() {
  try {
    const id = await requireSession();
    const result = await vivixRequest('/' + encodeURIComponent(id) + '/close', {});
    // Keep ownership while closing so the browser can verify cleanup or retry.
    if (result.status === 'closed') await clearSession();
    return Response.json(
      { session_id: id, status: result.status },
      { headers: { 'Cache-Control': 'no-store' } },
    );
  } catch (error) {
    return errorResponse(error);
  }
}
