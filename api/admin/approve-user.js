import { approveOrRejectUser, getPendingUsers } from "../../lib/auth/accounts.js";
import { isAdmin } from "../../lib/auth/guards.js";
import { prepare, requireSession, sendJson } from "../../lib/vercelHttp.js";

/**
 * Endpoint for Hub Owner / Admin to view and approve/reject pending users.
 * POST /api/admin/approve-user -> { userId, status: 'ACTIVE' | 'BANNED' | 'REJECTED' }
 * GET /api/admin/approve-user  -> lists pending users
 */
export default async function handler(req, res) {
  const { requestId } = prepare(req, res, process.env);
  const session = await requireSession(req, res, process.env, requestId);
  if (!session) return;

  if (!isAdmin(session)) {
    return sendJson(res, 403, {
      ok: false,
      code: "ROLE_FORBIDDEN",
      error: "Owner/Admin access required.",
      requestId,
    });
  }

  if (req.method === "GET") {
    const pending = await getPendingUsers(process.env);
    return sendJson(res, 200, { ok: true, users: pending, requestId });
  }

  if (req.method !== "POST") {
    res.setHeader("Allow", "GET, POST");
    return sendJson(res, 405, {
      ok: false,
      code: "METHOD_NOT_ALLOWED",
      error: "Method not allowed. Use GET or POST.",
      requestId,
    });
  }

  let body = req.body;
  if (typeof body === "string") {
    try {
      body = JSON.parse(body);
    } catch {
      body = {};
    }
  }

  const { userId, status } = body || {};
  if (!userId || !status) {
    return sendJson(res, 400, {
      ok: false,
      code: "INVALID_BODY",
      error: "'userId' and 'status' ('ACTIVE' or 'BANNED' / 'REJECTED') are required.",
      requestId,
    });
  }

  const result = await approveOrRejectUser(session.userId || "owner", userId, status, process.env);
  return sendJson(res, result.status, { ...result, requestId });
}
