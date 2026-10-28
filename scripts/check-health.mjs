const url = process.env.API_HEALTH_URL || "http://127.0.0.1:8000/api/health";
const timeoutMs = Number(process.env.CHECK_TIMEOUT_MS) || 5000;

const controller = new AbortController();
const timer = setTimeout(() => controller.abort(), timeoutMs);

try {
  const response = await fetch(url, { signal: controller.signal, cache: "no-store" });
  const body = await response.json().catch(() => null);
  const payloadOk =
    body &&
    typeof body === "object" &&
    (typeof body.ok === "boolean" || typeof body.status === "string");

  if (!payloadOk) {
    console.error(`FAIL  ${url} -> HTTP ${response.status} (unexpected payload)`);
    process.exitCode = 1;
  } else {
    // Reachability is the check. Health may legitimately be DEGRADED/ERROR when
    // server-side authority or provider verification is not configured.
    const status = body.status ?? "unknown";
    const reasons =
      Array.isArray(body.reasonCodes) && body.reasonCodes.length
        ? ` reason=${body.reasonCodes.join(",")}`
        : "";
    console.log(`PASS  backend reachable  ${url} -> HTTP ${response.status} status=${status}${reasons}`);
  }
} catch (error) {
  const reason =
    error?.name === "AbortError"
      ? `timeout after ${timeoutMs}ms`
      : error?.message || "request failed";
  console.error(`FAIL  ${url} -> ${reason}`);
  process.exitCode = 1;
} finally {
  clearTimeout(timer);
}
