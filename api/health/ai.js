import { createAiHealthReport } from "../../lib/subsystemHealth.js";
import { handleSubsystemHealth } from "../../lib/subsystemRoute.js";

// Private. Reports the cached provider snapshot only; no provider call is made
// here. Use /api/ai/status?force=1 for one explicit bounded verification.
export default async function handler(req, res) {
  return handleSubsystemHealth(req, res, () => createAiHealthReport({ env: process.env }));
}
