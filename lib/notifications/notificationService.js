import { taskStore } from "../tasks/taskStore.js";

const NOTIFICATION_STATUS = {
  COMPLETED: { title: "Task completed", kind: "success" },
  FAILED: { title: "Task failed", kind: "error" },
  AWAITING_APPROVAL: { title: "Approval required", kind: "approval" },
};

export function getNotifications({ limit = 25 } = {}) {
  const safeLimit = Math.min(Math.max(Number(limit) || 25, 1), 100);
  return taskStore
    .list({ limit: 200 })
    .filter((task) => NOTIFICATION_STATUS[task.status])
    .slice(0, safeLimit)
    .map((task) => {
      const definition = NOTIFICATION_STATUS[task.status];
      return {
        id: `task:${task.id}:${task.status}`,
        channel: "in_app",
        kind: definition.kind,
        title: definition.title,
        body:
          task.status === "FAILED"
            ? task.error?.message || "The task failed; no completion is claimed."
            : task.status === "AWAITING_APPROVAL"
              ? "A consequential action is waiting for control authorization."
              : task.result?.summary || "The task completed and was validated.",
        taskId: task.id,
        agentId: task.agentId,
        createdAt: task.updatedAt,
        read: false,
        externalDelivery: false,
      };
    });
}

export function getNotificationChannels() {
  return [
    { id: "in_app", label: "In-app", status: "operational", note: "Derived from stored task state." },
    { id: "email", label: "Email", status: "not_connected", note: "No SMTP provider is configured." },
    { id: "browser_push", label: "Browser push", status: "not_connected", note: "Not implemented." },
  ];
}
