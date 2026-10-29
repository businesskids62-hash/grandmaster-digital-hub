import { verifyCsrf } from "../auth/csrf.js";
import { resolveSession } from "../auth/guards.js";
import { getDatabase } from "../db/index.js";
import {
  completeLesson,
  getCourse,
  getLesson,
  getProfile,
  getProgress,
  getQuizForClient,
  listAttempts,
  listCourses,
  submitQuizAttempt,
} from "../academy/service.js";

const MAX_BODY_BYTES = 16 * 1024;
const ID_PATTERN = /^[A-Za-z0-9_-]{1,80}$/;

function segments(path) {
  return String(path || "")
    .split("/")
    .filter(Boolean);
}

function fail(status, code, error, requestId, headers = {}) {
  return { status, headers, body: { ok: false, code, error, requestId } };
}

function methodNotAllowed(allow, requestId) {
  return fail(405, "METHOD_NOT_ALLOWED", `Method not allowed. Use ${allow}.`, requestId, {
    Allow: allow,
  });
}

export function handleAcademy({
  method,
  path,
  headers = {},
  body,
  env = process.env,
  requestId,
  now = Date.now(),
}) {
  const session = resolveSession(headers, env, now);
  if (!session) {
    return fail(401, "AUTH_REQUIRED", "Authentication required.", requestId);
  }
  if (!session.userId) {
    return fail(
      403,
      "ACCOUNT_REQUIRED",
      "Sign in with an account to use the academy.",
      requestId,
    );
  }

  const verb = String(method || "GET").toUpperCase();
  const stateChanging = ["POST", "PUT", "PATCH", "DELETE"].includes(verb);
  if (stateChanging && session.format === "v2" && !verifyCsrf(headers)) {
    return fail(403, "CSRF_INVALID", "Request could not be verified.", requestId);
  }

  const declared = Number(headers?.["content-length"] || 0);
  if (Number.isFinite(declared) && declared > MAX_BODY_BYTES) {
    return fail(413, "REQUEST_TOO_LARGE", "Request body is too large.", requestId);
  }

  let db;
  try {
    db = getDatabase(env);
  } catch {
    return fail(
      503,
      "ACADEMY_DB_UNAVAILABLE",
      "Academy storage is unavailable right now.",
      requestId,
    );
  }

  const parts = segments(path);
  const userId = session.userId;

  try {
    if (parts.length === 1 && parts[0] === "courses") {
      if (verb !== "GET") return methodNotAllowed("GET", requestId);
      return {
        status: 200,
        body: { ok: true, requestId, courses: listCourses(db, userId) },
      };
    }

    if (parts.length === 2 && parts[0] === "courses") {
      if (verb !== "GET") return methodNotAllowed("GET", requestId);
      if (!ID_PATTERN.test(parts[1])) {
        return fail(400, "INVALID_ID", "Invalid course id.", requestId);
      }
      const course = getCourse(db, parts[1], userId);
      if (!course) return fail(404, "NOT_FOUND", "Course not found.", requestId);
      return { status: 200, body: { ok: true, requestId, course } };
    }

    if (parts.length === 2 && parts[0] === "lessons") {
      if (verb !== "GET") return methodNotAllowed("GET", requestId);
      if (!ID_PATTERN.test(parts[1])) {
        return fail(400, "INVALID_ID", "Invalid lesson id.", requestId);
      }
      const lesson = getLesson(db, parts[1], userId);
      if (!lesson) return fail(404, "NOT_FOUND", "Lesson not found.", requestId);
      return { status: 200, body: { ok: true, requestId, lesson } };
    }

    if (parts.length === 3 && parts[0] === "lessons" && parts[2] === "complete") {
      if (verb !== "POST") return methodNotAllowed("POST", requestId);
      if (!ID_PATTERN.test(parts[1])) {
        return fail(400, "INVALID_ID", "Invalid lesson id.", requestId);
      }
      const result = completeLesson(db, userId, parts[1]);
      if (!result) return fail(404, "NOT_FOUND", "Lesson not found.", requestId);
      return { status: 200, body: { ok: true, requestId, ...result } };
    }

    if (parts.length === 2 && parts[0] === "quizzes") {
      if (verb !== "GET") return methodNotAllowed("GET", requestId);
      if (!ID_PATTERN.test(parts[1])) {
        return fail(400, "INVALID_ID", "Invalid quiz id.", requestId);
      }
      const quiz = getQuizForClient(db, parts[1]);
      if (!quiz) return fail(404, "NOT_FOUND", "Quiz not found.", requestId);
      return { status: 200, body: { ok: true, requestId, quiz } };
    }

    if (parts.length === 3 && parts[0] === "quizzes" && parts[2] === "attempts") {
      if (!ID_PATTERN.test(parts[1])) {
        return fail(400, "INVALID_ID", "Invalid quiz id.", requestId);
      }
      if (verb === "GET") {
        return {
          status: 200,
          body: { ok: true, requestId, attempts: listAttempts(db, userId, parts[1]) },
        };
      }
      if (verb !== "POST") return methodNotAllowed("GET, POST", requestId);
      const payload = body && typeof body === "object" && !Array.isArray(body) ? body : {};
      const attempt = submitQuizAttempt(db, userId, parts[1], payload.answers);
      if (!attempt) return fail(404, "NOT_FOUND", "Quiz not found.", requestId);
      return { status: 201, body: { ok: true, requestId, attempt } };
    }

    if (parts.length === 1 && parts[0] === "progress") {
      if (verb !== "GET") return methodNotAllowed("GET", requestId);
      return {
        status: 200,
        body: { ok: true, requestId, progress: getProgress(db, userId) },
      };
    }

    if (parts.length === 1 && parts[0] === "profile") {
      if (verb !== "GET") return methodNotAllowed("GET", requestId);
      const profile = getProfile(db, userId);
      if (!profile) return fail(404, "NOT_FOUND", "Profile not found.", requestId);
      return { status: 200, body: { ok: true, requestId, profile } };
    }

    return fail(404, "NOT_FOUND", "Academy route not found.", requestId);
  } catch {
    return fail(500, "ACADEMY_ERROR", "Academy request failed.", requestId);
  }
}
