import { createStorageHealthReport } from "../../lib/subsystemHealth.js";
import { handleSubsystemHealth } from "../../lib/subsystemRoute.js";

// Private. Reads the live writer state of the task, memory and audit stores.
export default async function handler(req, res) {
  return handleSubsystemHealth(req, res, () => createStorageHealthReport());
}
