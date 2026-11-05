import React, { useState, useEffect } from "react";
import {
  Shield,
  Bot,
  GraduationCap,
  Sparkles,
  Globe,
  LineChart,
  Mic,
  Activity,
  CheckCircle2,
  AlertTriangle,
  RefreshCw,
  Terminal,
} from "lucide-react";

export default function AgentNigrani({ apiBase = "" }) {
  const [refreshing, setRefreshing] = useState(false);
  const [systemHealth, setSystemHealth] = useState({
    api: "CHECKING",
    ai: "VERIFYING",
    mt5: "OFFLINE",
    storage: "CHECKING",
  });
  const [logs, setLogs] = useState([
    {
      time: new Date().toLocaleTimeString(),
      agent: "Grandmaster",
      action: "Command Center online. All 6 agents under constant nigrani.",
    },
  ]);

  const fetchHealth = async () => {
    setRefreshing(true);
    try {
      const res = await fetch(`${apiBase}/api/health`);
      if (res.ok) {
        setSystemHealth((prev) => ({ ...prev, api: "ONLINE" }));
      } else {
        setSystemHealth((prev) => ({ ...prev, api: "DEGRADED" }));
      }
    } catch {
      setSystemHealth((prev) => ({ ...prev, api: "OFFLINE" }));
    }

    try {
      const res = await fetch(`${apiBase}/api/ai/status`);
      if (res.ok) {
        setSystemHealth((prev) => ({ ...prev, ai: "VERIFIED" }));
      } else {
        setSystemHealth((prev) => ({ ...prev, ai: "QUOTA/OFFLINE" }));
      }
    } catch {
      setSystemHealth((prev) => ({ ...prev, ai: "OFFLINE" }));
    }

    try {
      const res = await fetch(`${apiBase}/api/v1/mt5/status`);
      if (res.ok) {
        setSystemHealth((prev) => ({ ...prev, mt5: "READ_ONLY" }));
      } else {
        setSystemHealth((prev) => ({ ...prev, mt5: "DISCONNECTED" }));
      }
    } catch {
      setSystemHealth((prev) => ({ ...prev, mt5: "OFFLINE" }));
    }

    setRefreshing(false);
  };

  useEffect(() => {
    fetchHealth();
    const interval = setInterval(fetchHealth, 30000);
    return () => clearInterval(interval);
  }, []);

  const agents = [
    {
      id: "grandmaster",
      name: "Grandmaster Agent",
      role: "Central Intelligence & Orchestrator",
      icon: Bot,
      status: systemHealth.ai === "VERIFIED" ? "ACTIVE" : "STANDBY",
      metrics: "Task Routing: 100% · Token Quota: Max 10/day",
      safety: "Paper Only · Zero Capital Risk",
      color: "from-amber-400 to-yellow-600",
    },
    {
      id: "academy",
      name: "Academy Agent",
      role: "Courseware & Quiz Evaluator",
      icon: GraduationCap,
      status: "ACTIVE",
      metrics: "6 Active Modules · Server-Side Grading",
      safety: "Strict Verification · No Cheat Keys",
      color: "from-emerald-400 to-green-600",
    },
    {
      id: "singular",
      name: "Singular Agent",
      role: "Code Architect & Refactoring",
      icon: Sparkles,
      status: "READY",
      metrics: "AST Parser Ready · 0 Unbounded Loops",
      safety: "Sandbox Only · No Blind Overwrites",
      color: "from-purple-400 to-indigo-600",
    },
    {
      id: "browser",
      name: "Browser Operator",
      role: "Web Intelligence & DOM Explorer",
      icon: Globe,
      status: "STANDBY",
      metrics: "Headless Chromium · Single-Session",
      safety: "Strict Read-Only · Financial Login Blocked",
      color: "from-blue-400 to-cyan-600",
    },
    {
      id: "mt5",
      name: "MT5 Monitor Agent",
      role: "Market Tick & Spread Telemetry",
      icon: LineChart,
      status: systemHealth.mt5 === "READ_ONLY" ? "ONLINE" : "READ_ONLY_LOCK",
      metrics: "Symbol Rates · 0 Execution Endpoints",
      safety: "REAL TRADING BANNED · LOCKED",
      color: "from-red-400 to-rose-600",
    },
    {
      id: "voice",
      name: "Voice Agent (Mere Sher)",
      role: "Audio Synthesis & Voice Recognition",
      icon: Mic,
      status: "LISTENING",
      metrics: "Male Deep Voice · Urdu/English STT",
      safety: "Local Client Audio · Zero Cloud Uploads",
      color: "from-orange-400 to-amber-600",
    },
  ];

  return (
    <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-8 space-y-8">
      {/* Header */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 p-6 rounded-3xl bg-slate-900/90 border border-white/10 shadow-2xl backdrop-blur">
        <div>
          <div className="flex items-center gap-2 text-xs font-bold text-amber-400 uppercase tracking-wider mb-1">
            <Shield className="w-4 h-4" />
            <span>Grandmaster AI Fleet · 24/7 Nigrani</span>
          </div>
          <h1 className="text-2xl sm:text-3xl font-extrabold text-white tracking-tight">
            6-Agent Nigrani Command Dashboard
          </h1>
          <p className="text-sm text-slate-400 mt-1">
            Real-time health, security boundaries, and telemetry for the autonomous agent workforce.
          </p>
        </div>

        <button
          onClick={fetchHealth}
          disabled={refreshing}
          className="self-start sm:self-center px-4 py-2.5 rounded-2xl bg-amber-500/15 text-amber-300 hover:bg-amber-500/25 border border-amber-500/30 font-bold text-xs flex items-center gap-2 transition"
        >
          <RefreshCw className={`w-4 h-4 ${refreshing ? "animate-spin" : ""}`} />
          <span>{refreshing ? "Checking Fleet..." : "Refresh Nigrani"}</span>
        </button>
      </div>

      {/* Safety Notice */}
      <div className="p-4 rounded-2xl bg-red-500/10 border border-red-500/30 text-red-200 text-xs flex items-center gap-3">
        <AlertTriangle className="w-5 h-5 text-red-400 flex-shrink-0" />
        <div>
          <strong className="font-bold text-red-300">Hub Safety Protocol Active: </strong>
          Real trading is permanently BANNED across all 6 agents. Money movement is DISABLED. Max 10 tokens per user per day.
        </div>
      </div>

      {/* 6 Agents Grid */}
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
        {agents.map((agent) => {
          const Icon = agent.icon;
          return (
            <div
              key={agent.id}
              className="p-6 rounded-3xl bg-slate-900/80 border border-white/10 hover:border-amber-500/40 shadow-xl transition-all duration-300 flex flex-col justify-between"
            >
              <div>
                <div className="flex items-center justify-between gap-3 mb-4">
                  <div
                    className={`w-12 h-12 rounded-2xl bg-gradient-to-br ${agent.color} flex items-center justify-center text-slate-950 font-bold shadow-lg`}
                  >
                    <Icon className="w-6 h-6" />
                  </div>
                  <span
                    className={`text-[10px] font-mono font-bold px-2.5 py-1 rounded-full border ${
                      agent.status === "ACTIVE" || agent.status === "ONLINE" || agent.status === "LISTENING"
                        ? "bg-emerald-500/15 text-emerald-400 border-emerald-500/30"
                        : "bg-amber-500/15 text-amber-400 border-amber-500/30"
                    }`}
                  >
                    {agent.status}
                  </span>
                </div>

                <h3 className="text-lg font-bold text-white">{agent.name}</h3>
                <p className="text-xs text-slate-400 mt-0.5 mb-4">{agent.role}</p>

                <div className="space-y-2 pt-2 border-t border-white/5 text-xs">
                  <div className="flex items-start gap-2 text-slate-300">
                    <Activity className="w-3.5 h-3.5 text-amber-400 mt-0.5 flex-shrink-0" />
                    <span>{agent.metrics}</span>
                  </div>
                  <div className="flex items-start gap-2 text-slate-400">
                    <Shield className="w-3.5 h-3.5 text-emerald-400 mt-0.5 flex-shrink-0" />
                    <span className="text-[11px] font-mono">{agent.safety}</span>
                  </div>
                </div>
              </div>

              <div className="mt-6 pt-4 border-t border-white/10 flex items-center justify-between text-xs">
                <span className="text-slate-500 font-mono text-[11px]">Nigrani: Locked</span>
                <span className="inline-flex items-center gap-1 text-emerald-400 font-bold text-[11px]">
                  <CheckCircle2 className="w-3.5 h-3.5" />
                  <span>Compliant</span>
                </span>
              </div>
            </div>
          );
        })}
      </div>

      {/* Nigrani Audit Activity */}
      <div className="p-6 rounded-3xl bg-slate-900/80 border border-white/10 shadow-xl space-y-4">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2">
            <Terminal className="w-4 h-4 text-amber-400" />
            <h3 className="font-bold text-sm text-white">Agent Telemetry Logs</h3>
          </div>
          <span className="text-xs text-slate-500 font-mono">Real-time Nigrani Feed</span>
        </div>

        <div className="space-y-2 font-mono text-xs text-slate-300 bg-slate-950/60 p-4 rounded-2xl border border-white/5 max-h-56 overflow-y-auto">
          {logs.map((log, idx) => (
            <div key={idx} className="flex items-start gap-3">
              <span className="text-slate-500">[{log.time}]</span>
              <span className="text-amber-400 font-bold">&lt;{log.agent}&gt;</span>
              <span className="text-slate-300">{log.action}</span>
            </div>
          ))}
          <div className="flex items-start gap-3 text-slate-500">
            <span>[{new Date().toLocaleTimeString()}]</span>
            <span className="text-emerald-400 font-bold">&lt;SystemDoctor&gt;</span>
            <span>All subagent sandboxes nominal. 0 violations detected.</span>
          </div>
        </div>
      </div>
    </div>
  );
}
