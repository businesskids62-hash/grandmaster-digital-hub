import { createMt5HealthReport } from "../../lib/subsystemHealth.js";
import { handleSubsystemHealth } from "../../lib/subsystemRoute.js";

// Private. Performs one bounded read-only bridge probe (no login, no orders).
export default async function handler(req, res) {
  return handleSubsystemHealth(req, res, () => createMt5HealthReport({ env: process.env }));
}
