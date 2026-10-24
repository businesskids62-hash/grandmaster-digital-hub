/* ==========================================================================
   SYSTEM DIMAGH — System Brain
   Knows all 12 agents and system health.
   ========================================================================== */

const AGENTS_12 = [
  { code: "RESEARCH", name: "Research Agent", role: "Research, evidence and fact-checking" },
  { code: "CODING", name: "Coding Agent", role: "Code generation and development" },
  { code: "TESTING", name: "Testing Agent", role: "Tests and quality assurance" },
  { code: "BUSINESS", name: "Business Agent", role: "Business plans and opportunities" },
  { code: "CONTENT", name: "Content Agent", role: "Content ideas and drafts" },
  { code: "SOCIAL", name: "Social Media Agent", role: "Authorized social media workflows" },
  { code: "ANALYTICS", name: "Analytics Agent", role: "Reports and performance analysis" },
  { code: "LEARNING", name: "Learning Agent", role: "Structured learning and lessons" },
  { code: "PROJECTS", name: "Project Agent", role: "Projects, tasks and milestones" },
  { code: "SECURITY", name: "Security Agent", role: "Security reviews and risk checks" },
  { code: "FINANCE", name: "Finance Agent", role: "Income and expense records" },
  { code: "DEPLOY", name: "Deployment Agent", role: "Build and deployment assistance" },
];

function nowISO() {
  return new Date().toISOString();
}

class SystemDimagh {
  constructor() {
    this.agents = AGENTS_12.map((a) => ({
      ...a,
      status: "idle",
      lastChecked: null,
    }));
    this.health = {
      overall: "online",
      checkedAt: nowISO(),
      agentCount: this.agents.length,
    };
    this.logs = [];
    this.active = false;
  }

  /* ---- activation ---- */
  activate() {
    this.active = true;
    this.refreshHealth();
    console.log("[Dimagh] Zinda");
    return this.getHealth();
  }

  deactivate() {
    this.active = false;
  }

  isActive() {
    return this.active;
  }

  /* ---- agents ---- */
  getAgents() {
    return this.agents.map((a) => ({ ...a }));
  }

  getAgent(code) {
    return this.agents.find((a) => a.code === code);
  }

  setAgentStatus(code, status) {
    const agent = this.getAgent(code);
    if (agent) {
      agent.status = status;
      agent.lastChecked = nowISO();
    }
    return this.getAgent(code);
  }

  /* ---- health ---- */
  refreshHealth() {
    const statuses = this.agents.map((a) => a.status);
    const allIdle = statuses.every((s) => s === "idle");
    const anyWorking = statuses.some((s) => s === "working");
    this.health = {
      overall: anyWorking ? "busy" : allIdle ? "online" : "degraded",
      checkedAt: nowISO(),
      agentCount: this.agents.length,
      workingCount: statuses.filter((s) => s === "working").length,
      idleCount: statuses.filter((s) => s === "idle").length,
    };
    return this.health;
  }

  getHealth() {
    this.refreshHealth();
    return { ...this.health, active: this.active };
  }

  /* ---- logs ---- */
  addLog(message, type = "info") {
    const entry = {
      id: `${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
      time: nowISO(),
      message,
      type,
    };
    this.logs.unshift(entry);
    if (this.logs.length > 200) this.logs.pop();
    console.log(`[Dimagh] ${message}`);
    return entry;
  }

  getLogs(limit = 50) {
    return this.logs.slice(0, limit);
  }

  clearLogs() {
    this.logs = [];
  }

  getSnapshot() {
    return {
      active: this.active,
      health: this.getHealth(),
      agents: this.getAgents(),
      logs: this.getLogs(),
    };
  }
}

export const systemDimagh = new SystemDimagh();
export default systemDimagh;
export { SystemDimagh, AGENTS_12 };
