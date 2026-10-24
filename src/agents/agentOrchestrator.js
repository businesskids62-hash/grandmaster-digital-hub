/* ==========================================================================
   AGENT ORCHESTRATOR — 12 agents talking
   Logs: [Agent] working
   ========================================================================== */

import { AGENTS_12 } from "./systemDimagh.js";

class AgentOrchestrator {
  constructor() {
    this.agents = AGENTS_12.map((a) => ({
      ...a,
      status: "idle",
      lastTask: null,
    }));
    this.logs = [];
    this.master = "Mastermind";
  }

  /* ---- roster ---- */
  getRoster() {
    return this.agents.map((a) => ({ ...a }));
  }

  getAgent(code) {
    return this.agents.find((a) => a.code === code);
  }

  /* ---- logging: [Agent] working ---- */
  log(agentCodeOrName, message) {
    const agent =
      this.getAgent(agentCodeOrName) ||
      this.agents.find((a) => a.name === agentCodeOrName) ||
      { code: agentCodeOrName, name: String(agentCodeOrName) };
    const entry = {
      id: `${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
      time: new Date().toISOString(),
      agent: agent.name,
      code: agent.code,
      message: message || "working",
    };
    const line = `[${agent.name}] ${entry.message}`;
    this.logs.unshift(entry);
    if (this.logs.length > 200) this.logs.pop();
    console.log(line);
    return line;
  }

  /* ---- mark an agent working ---- */
  setWorking(code) {
    const agent = this.getAgent(code);
    if (agent) {
      agent.status = "working";
      agent.lastTask = new Date().toISOString();
      this.log(code, "working");
    }
    return agent;
  }

  setIdle(code) {
    const agent = this.getAgent(code);
    if (agent) agent.status = "idle";
    return agent;
  }

  /* ---- run a task through an agent ---- */
  run(code, task) {
    const agent = this.getAgent(code);
    if (!agent) throw new Error(`Agent ${code} not found`);
    this.setWorking(code);
    this.log(code, `Task: ${task}`);
    return { agent, task, startedAt: new Date().toISOString() };
  }

  /* ---- run all 12 agents (team talk) ---- */
  runTeam(task) {
    const results = this.agents.map((a) => this.run(a.code, task));
    this.log(this.master, `Team plan started: ${task}`);
    return results;
  }

  getLogs(limit = 50) {
    return this.logs.slice(0, limit);
  }

  clearLogs() {
    this.logs = [];
  }

  getSnapshot() {
    return {
      agents: this.getRoster(),
      logs: this.getLogs(),
    };
  }
}

export const agentOrchestrator = new AgentOrchestrator();
export default agentOrchestrator;
export { AgentOrchestrator };
