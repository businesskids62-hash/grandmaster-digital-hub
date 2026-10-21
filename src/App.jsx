import { useState, useEffect, useRef } from "react";

// Set window.GRANDMASTER_API_BASE (e.g. in index.html) to point at your backend.
// Empty string means same-origin requests like /api/chat.
const API_BASE = (
  (typeof window !== "undefined" && window.GRANDMASTER_API_BASE) ||
  ""
).replace(/\/$/, "");
const DEFAULT_MODEL = "AI Provider";
const STORAGE_KEY = "grandmaster_dashboard_v1";

const NAVIGATION = [
  { id: "overview", icon: "◈", label: "Command Center" },
  { id: "assistant", icon: "✦", label: "Grandmaster AI" },
  { id: "builder", icon: "⌘", label: "App Builder" },
  { id: "agents", icon: "⬡", label: "AI Agents" },
  { id: "roadmap", icon: "▤", label: "100-Step Roadmap" },
  { id: "projects", icon: "▣", label: "Projects & Tasks" },
  { id: "business", icon: "↗", label: "Business Center" },
  { id: "integrations", icon: "⌘", label: "Integrations" },
  { id: "security", icon: "⬢", label: "Security Center" },
];

const AGENTS = [
  ["Research Agent", "Research, evidence and fact-checking", "RESEARCH"],
  ["Coding Agent", "Code generation and development", "CODING"],
  ["Testing Agent", "Tests and quality assurance", "TESTING"],
  ["Business Agent", "Business plans and opportunities", "BUSINESS"],
  ["Content Agent", "Content ideas and drafts", "CONTENT"],
  ["Social Media Agent", "Authorized social media workflows", "SOCIAL"],
  ["Analytics Agent", "Reports and performance analysis", "ANALYTICS"],
  ["Learning Agent", "Structured learning and lessons", "LEARNING"],
  ["Project Agent", "Projects, tasks and milestones", "PROJECTS"],
  ["Security Agent", "Security reviews and risk checks", "SECURITY"],
  ["Trading Monitor", "Read-only market monitoring", "TRADING"],
  ["Finance Agent", "Income and expense records", "FINANCE"],
  ["Documentation Agent", "Technical documentation", "DOCS"],
  ["Deployment Agent", "Build and deployment assistance", "DEPLOY"],
  ["QA Agent", "Regression and acceptance testing", "QA"],
  ["Memory Agent", "Project notes and saved preferences", "MEMORY"],
  ["Automation Agent", "Approved workflow automation", "AUTOMATION"],
  ["API Agent", "API integration assistance", "API"],
  ["Product Agent", "Product planning and prioritization", "PRODUCT"],
  ["Mastermind", "Coordinate tasks and summarize progress", "MASTER"],
];

const PHASES = [
  ["A", "Discovery & Protection", 1, 10],
  ["B", "Foundation & Repair", 11, 20],
  ["C", "Frontend Engineering", 21, 30],
  ["D", "Backend Engineering", 31, 40],
  ["E", "AI Brain", 41, 50],
  ["F", "Data & Management", 51, 60],
  ["G", "Agent System", 61, 70],
  ["H", "Business & Integrations", 71, 80],
  ["I", "Production Readiness", 81, 90],
  ["J", "Reliability & Growth", 91, 100],
];

const ROADMAP = [
  "Locate original project",
  "Inspect repository structure",
  "Inspect package.json",
  "Identify application entry points",
  "Map routes and navigation",
  "Inventory existing features",
  "Inspect frontend components",
  "Inspect backend services",
  "Inspect environment configuration",
  "Complete initial audit report",
  "Establish Git checkpoint",
  "Reproduce existing errors",
  "Repair startup failures",
  "Repair routing issues",
  "Repair broken imports",
  "Repair dependency problems",
  "Repair frontend rendering",
  "Repair API communication",
  "Repair configuration",
  "Verify production build",
  "Standardize shared layouts",
  "Improve responsive navigation",
  "Create reusable components",
  "Improve forms and validation",
  "Add loading states",
  "Add empty states",
  "Improve error handling",
  "Improve accessibility",
  "Verify mobile layouts",
  "Test user journeys",
  "Audit server entry points",
  "Standardize API errors",
  "Add input validation",
  "Configure health checks",
  "Secure environment variables",
  "Define authentication requirements",
  "Define authorization rules",
  "Configure database if required",
  "Add structured logging",
  "Test backend endpoints",
  "Audit AI integrations",
  "Establish AI service interface",
  "Configure supported providers",
  "Secure AI API calls",
  "Implement connection status",
  "Implement conversation handling",
  "Add persistent history if required",
  "Handle provider failures",
  "Add AI service tests",
  "Verify provider connectivity",
  "Define data models",
  "Implement project management",
  "Implement task tracking",
  "Implement goal tracking",
  "Implement decision records",
  "Implement search",
  "Add data access controls",
  "Add data export if required",
  "Plan backups and recovery",
  "Test data persistence",
  "Define central orchestrator",
  "Define agent interfaces",
  "Implement first useful agent",
  "Add agent execution status",
  "Add workflow logging",
  "Add failure recovery",
  "Add permission boundaries",
  "Add approval checkpoints",
  "Test multi-step workflows",
  "Verify agent execution",
  "Implement business planning",
  "Implement learning workflows",
  "Implement content drafting",
  "Audit social integrations",
  "Verify account permissions",
  "Implement approved publishing",
  "Implement authorized analytics",
  "Implement financial records",
  "Implement read-only market monitoring",
  "Test integration failures",
  "Review application security",
  "Review dependency vulnerabilities",
  "Review authentication and authorization",
  "Review performance",
  "Review database access",
  "Configure production environment",
  "Configure deployment",
  "Verify production API routing",
  "Run regression tests",
  "Verify deployed application",
  "Add operational health reporting",
  "Improve error messages",
  "Add useful usage analytics",
  "Improve recovery procedures",
  "Document architecture",
  "Document installation",
  "Document environment configuration",
  "Create release checklist",
  "Verify acceptance criteria",
  "Produce final readiness report",
];

const INITIAL_DATA = {
  tasks: [],
  completedSteps: [],
  activity: [],
};

const css = `
:root {
  color-scheme: dark;
  --bg: #080a11;
  --panel: #10131e;
  --panel2: #171b29;
  --border: rgba(255,255,255,.085);
  --text: #f1f3fa;
  --muted: #9098ad;
  --gold: #f5bc4b;
  --gold2: #ffe09a;
  --green: #40d6a0;
  --red: #ff737d;
  --blue: #85a9ff;
}
* { box-sizing: border-box; }
body { margin: 0; background: var(--bg); }
button, input, textarea, select { font: inherit; }
button { cursor: pointer; }
button:disabled { opacity: .5; cursor: not-allowed; }
button:focus-visible, input:focus-visible, textarea:focus-visible, select:focus-visible {
  outline: 2px solid var(--gold); outline-offset: 3px;
}
.gm {
  min-height: 100vh;
  background: radial-gradient(ellipse at 60% -20%,rgba(245,188,75,.09),transparent 45%),var(--bg);
  color: var(--text); font: 14px/1.5 Inter,system-ui,-apple-system,"Segoe UI",sans-serif;
}
.gm * { box-sizing: border-box; }
.gm button { color: inherit; }
.gm button:disabled { cursor: not-allowed; }
.gm-layout { min-height: 100vh; }
.gm-sidebar {
  width: 248px; position: fixed; inset: 0 auto 0 0; z-index: 30;
  background: rgba(12,15,24,.97); border-right: 1px solid var(--border);
  display: flex; flex-direction: column; padding: 20px 14px; overflow-y: auto;
}
.gm-brand { display:flex;align-items:center;gap:12px;padding:4px 7px 24px; }
.gm-logo {
  width:43px;height:43px;border-radius:13px;display:grid;place-items:center;
  color:#211706;background:linear-gradient(135deg,var(--gold2),var(--gold));
  font-weight:1000;font-size:21px;box-shadow:0 5px 25px #f5bc4b26;
}
.gm-brand-name { font-size:17px;font-weight:850;letter-spacing:-.5px; }
.gm-brand-sub { color:var(--gold);font-size:9px;letter-spacing:2.1px;font-weight:800; }
.gm-section-label { padding:12px 10px 8px;color:#727b91;font-size:10px;font-weight:800;letter-spacing:1.5px; }
.gm-nav { display:flex;flex-direction:column;gap:5px; }
.gm-nav button {
  display:flex;align-items:center;gap:11px;text-align:left;width:100%;
  border:1px solid transparent;border-radius:10px;padding:11px 12px;
  background:transparent;color:#aab0c1;font-size:12.5px;transition:.15s;
}
.gm-nav button:hover { background:#ffffff08;color:white; }
.gm-nav button.active { background:#f5bc4b12;color:var(--gold2);border-color:#f5bc4b2c; }
.gm-nav-icon { width:19px;text-align:center;font-size:17px; }
.gm-sidebar-bottom { margin-top:auto;padding-top:24px; }
.gm-safety-mini { border:1px solid #40d6a026;background:#40d6a008;border-radius:12px;padding:12px; }
.gm-safety-title { display:flex;align-items:center;gap:7px;color:var(--green);font-weight:800;font-size:11px; }
.gm-safety-mini p { color:var(--muted);font-size:10px;margin:7px 0 0;line-height:1.7; }
.gm-main { margin-left:248px;min-width:0; }
.gm-topbar {
  height:70px;position:sticky;top:0;z-index:20;background:#0b0d15ed;
  backdrop-filter:blur(18px);border-bottom:1px solid var(--border);
  display:flex;align-items:center;justify-content:space-between;padding:0 30px;gap:12px;
}
.gm-top-left,.gm-top-right { display:flex;align-items:center;gap:12px; }
.gm-eyebrow { color:var(--muted);font-size:11px; }
.gm-page-title { font-weight:800;font-size:15px; }
.gm-status { display:inline-flex;align-items:center;gap:7px;border:1px solid var(--border);
  background:var(--panel);border-radius:999px;padding:7px 10px;font-size:10px;color:var(--muted); }
.gm-dot { width:7px;height:7px;border-radius:50%;background:#788197; }
.gm-status.live { color:var(--green);border-color:#40d6a033; }
.gm-status.live .gm-dot { background:var(--green);box-shadow:0 0 9px #40d6a0; }
.gm-status.off { color:var(--red);border-color:#ff737d33; }
.gm-status.off .gm-dot { background:var(--red); }
.gm-icon-btn { border:1px solid var(--border);background:var(--panel);border-radius:10px;padding:8px 11px; }
.gm-content { max-width:1500px;margin:0 auto;padding:28px 30px 70px; }
.gm-welcome { display:flex;align-items:flex-start;justify-content:space-between;gap:20px;margin-bottom:26px; }
.gm-kicker { color:var(--gold);font-size:10px;letter-spacing:2px;font-weight:900;text-transform:uppercase; }
.gm-h1 { font-size:clamp(25px,3vw,36px);letter-spacing:-1.2px;line-height:1.2;margin:7px 0 9px;font-weight:850; }
.gm-gradient { background:linear-gradient(100deg,var(--gold2),var(--gold));-webkit-background-clip:text;background-clip:text;color:transparent; }
.gm-muted { color:var(--muted); }
.gm-small { font-size:11px; }
.gm-btn { display:inline-flex;align-items:center;justify-content:center;gap:8px;padding:10px 14px;border-radius:10px;border:1px solid var(--border);background:var(--panel2);font-weight:700;font-size:12px;transition:.15s; }
.gm-btn:hover:not(:disabled) { border-color:#f5bc4b66;transform:translateY(-1px); }
.gm-btn.primary { background:linear-gradient(135deg,var(--gold2),var(--gold));color:#211706;border-color:transparent; }
.gm-btn.ghost { background:transparent; }
.gm-btn.danger { color:var(--red); }
.gm-grid { display:grid;gap:15px; }
.gm-stats { grid-template-columns:repeat(4,minmax(0,1fr));margin-bottom:20px; }
.gm-card { background:linear-gradient(145deg,#121622,#0e111a);border:1px solid var(--border);border-radius:15px;padding:18px;min-width:0; }
.gm-card-title { display:flex;justify-content:space-between;align-items:center;gap:10px;font-size:12px;font-weight:750; }
.gm-stat-icon { display:grid;place-items:center;width:35px;height:35px;border-radius:10px;background:#f5bc4b12;color:var(--gold);font-size:17px; }
.gm-stat-value { font-size:29px;font-weight:850;letter-spacing:-1px;margin:16px 0 3px; }
.gm-stat-note { font-size:10px;color:var(--muted); }
.gm-two { grid-template-columns:minmax(0,1.5fr) minmax(270px,1fr);margin-bottom:20px; }
.gm-card-head { display:flex;align-items:center;justify-content:space-between;gap:12px;margin-bottom:16px; }
.gm-card-head h2 { margin:0;font-size:14px;font-weight:800; }
.gm-card-head p { margin:4px 0 0;font-size:10px;color:var(--muted); }
.gm-list { display:flex;flex-direction:column;gap:9px; }
.gm-list-row { display:flex;align-items:center;gap:12px;padding:11px;border:1px solid var(--border);border-radius:11px;background:#ffffff03; }
.gm-row-icon { width:36px;height:36px;flex:0 0 36px;display:grid;place-items:center;border-radius:10px;background:#f5bc4b12;color:var(--gold);font-size:16px; }
.gm-row-main { flex:1;min-width:0; }
.gm-row-title { font-size:12px;font-weight:750;overflow-wrap:anywhere; }
.gm-row-sub { font-size:10px;color:var(--muted);margin-top:3px; }
.gm-pill { display:inline-flex;align-items:center;gap:5px;border-radius:999px;padding:5px 8px;font-size:9px;font-weight:850;letter-spacing:.3px;background:#ffffff08;border:1px solid var(--border);color:var(--muted);white-space:nowrap; }
.gm-pill.green { color:var(--green);background:#40d6a00d;border-color:#40d6a02b; }
.gm-pill.gold { color:var(--gold2);background:#f5bc4b0d;border-color:#f5bc4b2b; }
.gm-pill.red { color:var(--red);background:#ff737d0d;border-color:#ff737d2b; }
.gm-progress { height:6px;background:#ffffff0c;border-radius:99px;overflow:hidden; }
.gm-progress-fill { height:100%;border-radius:99px;background:linear-gradient(90deg,var(--gold),var(--gold2));transition:width .3s; }
.gm-quick-grid { display:grid;grid-template-columns:repeat(3,minmax(0,1fr));gap:10px; }
.gm-quick { text-align:left;border:1px solid var(--border);background:#ffffff03;border-radius:12px;padding:14px;min-height:100px; }
.gm-quick:hover { border-color:#f5bc4b66;background:#f5bc4b08; }
.gm-quick-icon { font-size:21px;color:var(--gold);margin-bottom:8px; }
.gm-quick-title { font-weight:800;font-size:12px; }
.gm-quick-desc { font-size:10px;color:var(--muted);margin-top:4px; }
.gm-field { width:100%;border:1px solid var(--border);border-radius:10px;background:#090c14;color:var(--text);padding:12px;outline:none; }
.gm-field:focus { border-color:#f5bc4b88; }
.gm-textarea { width:100%;min-height:130px;resize:vertical;line-height:1.7; }
.gm-form { display:flex;flex-direction:column;gap:12px; }
.gm-label { display:block;font-size:11px;font-weight:800;color:#c3c9d8;margin-bottom:7px; }
.gm-builder { border:1px solid #f5bc4b26;background:linear-gradient(130deg,#f5bc4b0c,#10131e 55%);border-radius:17px;padding:22px; }
.gm-builder textarea { min-height:145px; }
.gm-suggestions { display:flex;flex-wrap:wrap;gap:8px;margin-top:12px; }
.gm-chip { padding:7px 10px;border:1px solid var(--border);border-radius:99px;background:#ffffff04;color:#c4cad8;font-size:10px; }
.gm-chip:hover { color:var(--gold2);border-color:#f5bc4b77; }
.gm-output { margin-top:18px;border:1px solid var(--border);border-radius:13px;overflow:hidden; }
.gm-output-head { display:flex;align-items:center;justify-content:space-between;gap:10px;background:var(--panel2);padding:11px 14px;border-bottom:1px solid var(--border); }
.gm-output pre { white-space:pre-wrap;overflow-wrap:anywhere;max-height:500px;overflow:auto;padding:16px;margin:0;font:12px/1.8 ui-monospace,Consolas,monospace;color:#dce1ef; }
.gm-chat { display:flex;flex-direction:column;height:min(650px,70vh);min-height:380px;border:1px solid var(--border);border-radius:15px;overflow:hidden;background:#0d1019; }
.gm-messages { flex:1;overflow-y:auto;display:flex;flex-direction:column;gap:13px;padding:18px; }
.gm-message { max-width:88%;white-space:pre-wrap;overflow-wrap:anywhere;padding:12px 14px;border-radius:13px;font-size:12px;line-height:1.8; }
.gm-message.user { align-self:flex-end;background:linear-gradient(135deg,var(--gold2),var(--gold));color:#211706;border-bottom-right-radius:3px; }
.gm-message.ai { align-self:flex-start;background:var(--panel2);border:1px solid var(--border);border-bottom-left-radius:3px; }
.gm-chat-form { display:flex;align-items:flex-end;gap:9px;padding:12px;border-top:1px solid var(--border); }
.gm-chat-form textarea { min-height:43px;max-height:130px;resize:vertical; }
.gm-empty { padding:28px 15px;text-align:center;color:var(--muted);font-size:12px; }
.gm-agent-grid { grid-template-columns:repeat(3,minmax(0,1fr)); }
.gm-agent { border:1px solid var(--border);background:var(--panel);border-radius:13px;padding:15px;min-width:0; }
.gm-agent-top { display:flex;align-items:center;justify-content:space-between;gap:8px;margin-bottom:13px; }
.gm-agent-icon { width:36px;height:36px;display:grid;place-items:center;background:#f5bc4b12;border-radius:10px;color:var(--gold);font-size:16px; }
.gm-agent h3 { font-size:12px;margin:0 0 6px; }
.gm-agent p { font-size:10px;color:var(--muted);min-height:31px;margin:0 0 12px; }
.gm-roadmap-phase { border:1px solid var(--border);border-radius:13px;background:var(--panel);margin-bottom:12px;overflow:hidden; }
.gm-phase-head { width:100%;display:flex;align-items:center;gap:12px;text-align:left;padding:15px;border:0;background:transparent; }
.gm-phase-letter { display:grid;place-items:center;width:34px;height:34px;border-radius:10px;background:#f5bc4b12;color:var(--gold);font-weight:900; }
.gm-phase-main { flex:1; }
.gm-phase-main strong { display:block;font-size:12px; }
.gm-phase-main span { color:var(--muted);font-size:10px; }
.gm-phase-body { padding:0 14px 12px; }
.gm-step { display:flex;align-items:center;gap:10px;padding:10px 4px;border-top:1px solid #ffffff08; }
.gm-step-num { width:26px;color:#7d879c;font-size:10px;font-weight:800; }
.gm-step-title { flex:1;font-size:11px; }
.gm-step input { accent-color:var(--gold);width:15px;height:15px; }
.gm-task { display:flex;align-items:center;gap:10px;border:1px solid var(--border);border-radius:10px;padding:11px;margin-bottom:8px; }
.gm-task input { accent-color:var(--gold); }
.gm-task-text { flex:1;overflow-wrap:anywhere;font-size:12px; }
.gm-task.done .gm-task-text { text-decoration:line-through;color:var(--muted); }
.gm-divider { height:1px;background:var(--border);margin:17px 0; }
.gm-notice { border:1px solid #f5bc4b2b;background:#f5bc4b08;color:#d5d8e3;border-radius:12px;padding:13px;font-size:11px;line-height:1.8; }
.gm-notice strong { color:var(--gold2); }
.gm-notice.danger { border-color:#ff737d35;background:#ff737d08; }
.gm-footer { margin-top:45px;padding-top:18px;border-top:1px solid var(--border);color:#727b91;font-size:10px;text-align:center; }
.gm-toast { position:fixed;right:20px;bottom:20px;z-index:100;border:1px solid #40d6a044;background:#101c1a;color:var(--green);padding:12px 16px;border-radius:11px;box-shadow:0 10px 35px #0008;font-size:12px; }
.gm-menu-toggle { display:none; }
@media(max-width:1100px) {
  .gm-sidebar { width:220px; }
  .gm-main { margin-left:220px; }
  .gm-content { padding:24px 20px 60px; }
  .gm-stats { grid-template-columns:repeat(2,minmax(0,1fr)); }
  .gm-agent-grid { grid-template-columns:repeat(2,minmax(0,1fr)); }
  .gm-two { grid-template-columns:1fr; }
}
@media(max-width:760px) {
  .gm-sidebar { width:270px;transform:translateX(-102%);transition:transform .22s;box-shadow:none; }
  .gm-sidebar.open { transform:translateX(0);box-shadow:25px 0 60px #0008; }
  .gm-main { margin-left:0; }
  .gm-topbar { height:62px;padding:0 14px; }
  .gm-menu-toggle { display:inline-flex; }
  .gm-content { padding:23px 14px 50px; }
  .gm-welcome { flex-direction:column; }
  .gm-stats { gap:10px; }
  .gm-card { padding:14px; }
  .gm-stat-value { font-size:25px; }
  .gm-quick-grid { grid-template-columns:repeat(2,minmax(0,1fr)); }
  .gm-agent-grid { grid-template-columns:1fr; }
  .gm-status { padding:7px; }
  .gm-status-label { display:none; }
  .gm-message { max-width:95%; }
}
@media(max-width:390px) {
  .gm-stats { grid-template-columns:1fr 1fr; }
  .gm-top-right { gap:6px; }
  .gm-stat-value { font-size:22px; }
}
@media(prefers-reduced-motion:reduce) {
  *,*::before,*::after { scroll-behavior:auto!important;animation:none!important;transition:none!important; }
}
`;

function readSavedData() {
  try {
    const value = JSON.parse(localStorage.getItem(STORAGE_KEY) || "null");
    if (!value || typeof value !== "object") return INITIAL_DATA;
    return {
      tasks: Array.isArray(value.tasks) ? value.tasks : [],
      completedSteps: Array.isArray(value.completedSteps)
        ? value.completedSteps.filter(
            (n) => Number.isInteger(n) && n >= 1 && n <= 100,
          )
        : [],
      activity: Array.isArray(value.activity)
        ? value.activity.slice(0, 30)
        : [],
    };
  } catch {
    return INITIAL_DATA;
  }
}

async function apiRequest(path, options = {}) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 30000);

  try {
    const response = await fetch(`${API_BASE}${path}`, {
      ...options,
      signal: controller.signal,
      headers: {
        "Content-Type": "application/json",
        ...(options.headers || {}),
      },
    });

    if (!response.ok) {
      throw new Error(`Request failed (${response.status})`);
    }

    return await response.json();
  } finally {
    clearTimeout(timer);
  }
}

async function askGrandmaster(message, history = []) {
  const data = await apiRequest("/api/chat", {
    method: "POST",
    body: JSON.stringify({
      message,
      history: history.slice(-12).map((item) => ({
        role: item.role === "user" ? "user" : "assistant",
        content: item.text,
      })),
    }),
  });

  const reply = data.reply || data.response || data.message;

  if (typeof reply !== "string" || !reply.trim()) {
    throw new Error("Backend returned no assistant response.");
  }

  return reply;
}

function StatusPill({ children, type = "" }) {
  return <span className={`gm-pill ${type}`}>{children}</span>;
}

function StatCard({ icon, title, value, note }) {
  return (
    <div className="gm-card">
      <div className="gm-card-title">
        <span>{title}</span>
        <span className="gm-stat-icon">{icon}</span>
      </div>
      <div className="gm-stat-value">{value}</div>
      <div className="gm-stat-note">{note}</div>
    </div>
  );
}

function SectionHeader({ title, subtitle, action }) {
  return (
    <div className="gm-card-head">
      <div>
        <h2>{title}</h2>
        {subtitle && <p>{subtitle}</p>}
      </div>
      {action}
    </div>
  );
}

function EmptyState({ children }) {
  return <div className="gm-empty">{children}</div>;
}

export default function App() {
  const [page, setPage] = useState("overview");
  const [menuOpen, setMenuOpen] = useState(false);
  const [backend, setBackend] = useState("CHECKING");
  const [model, setModel] = useState(DEFAULT_MODEL);
  const [healthError, setHealthError] = useState("");
  const [refreshing, setRefreshing] = useState(false);

  const [prompt, setPrompt] = useState("");
  const [building, setBuilding] = useState(false);
  const [generated, setGenerated] = useState("");
  const [buildError, setBuildError] = useState("");
  const [copied, setCopied] = useState(false);

  const [chatInput, setChatInput] = useState("");
  const [sending, setSending] = useState(false);
  const [chatError, setChatError] = useState("");
  const [history, setHistory] = useState([
    {
      role: "assistant",
      text: "Assalamu Alaikum! Main Grandmaster AI hoon. Main aapke projects, coding, business planning aur roadmap mein madad kar sakta hoon. Aaj kis mission par kaam karein?",
    },
  ]);

  const [taskInput, setTaskInput] = useState("");
  const [tasks, setTasks] = useState(() => readSavedData().tasks);
  const [completedSteps, setCompletedSteps] = useState(
    () => readSavedData().completedSteps,
  );
  const [activity, setActivity] = useState(() => readSavedData().activity);
  const [expandedPhases, setExpandedPhases] = useState(["A"]);
  const [toast, setToast] = useState("");

  const messagesEndRef = useRef(null);
  const promptRef = useRef(null);

  const completedCount = completedSteps.length;
  const taskCount = tasks.length;
  const finishedTasks = tasks.filter((task) => task.done).length;

  useEffect(() => {
    try {
      localStorage.setItem(
        STORAGE_KEY,
        JSON.stringify({ tasks, completedSteps, activity }),
      );
    } catch {
      setToast("Browser storage unavailable. Changes may not persist.");
    }
  }, [tasks, completedSteps, activity]);

  useEffect(() => {
    if (page === "assistant") {
      messagesEndRef.current?.scrollIntoView({ behavior: "smooth" });
    }
  }, [history, sending, page]);

  useEffect(() => {
    if (!toast) return;
    const timer = setTimeout(() => setToast(""), 2800);
    return () => clearTimeout(timer);
  }, [toast]);

  useEffect(() => {
    checkHealth();

    // Recheck connectivity periodically without claiming unverified availability.
    const timer = setInterval(() => {
      if (document.visibilityState === "visible") checkHealth();
    }, 60000);
    return () => clearInterval(timer);
    // checkHealth is intentionally invoked on mount and interval.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  async function checkHealth() {
    setRefreshing(true);

    try {
      const data = await apiRequest("/api/health", { method: "GET" });

      setBackend("LIVE");
      setHealthError("");

      if (typeof data.primary === "string") {
        setModel(data.primary);
      } else if (typeof data.model === "string") {
        setModel(data.model);
      }
    } catch (error) {
      setBackend("OFF");
      setHealthError(
        error.name === "AbortError"
          ? "Backend request timed out."
          : "Backend health endpoint unavailable.",
      );
    } finally {
      setRefreshing(false);
    }
  }

  function logActivity(message) {
    setActivity((previous) =>
      [
        {
          id: `${Date.now()}-${Math.random().toString(36).slice(2, 7)}`,
          message,
          time: new Date().toLocaleString(),
        },
        ...previous,
      ].slice(0, 30),
    );
  }

  function navigate(id) {
    setPage(id);
    setMenuOpen(false);
  }

  async function handleBuild() {
    const value = prompt.trim();

    if (!value || building) return;

    if (backend !== "LIVE") {
      setBuildError(
        "Backend offline hai. Pehle backend connection verify karein.",
      );
      return;
    }

    setBuilding(true);
    setBuildError("");
    setGenerated("");

    try {
      const answer = await askGrandmaster(
        `You are Grandmaster's software engineering assistant.
Help implement this application request:
${value}

Return a practical implementation plan and code where appropriate.
Clearly distinguish suggested code from files actually created.
Do not claim that files were written, tests were run, or deployments succeeded unless tools explicitly confirm those actions.`,
      );

      setGenerated(answer);
      logActivity("AI builder generated a response.");
    } catch (error) {
      setBuildError(error.message || "AI builder request failed.");
    } finally {
      setBuilding(false);
    }
  }

  async function sendChat(event) {
    event?.preventDefault();

    const value = chatInput.trim();

    if (!value || sending) return;

    if (backend !== "LIVE") {
      setChatError("Backend offline hai. Connection check karein.");
      return;
    }

    const updatedHistory = [...history, { role: "user", text: value }];

    setHistory(updatedHistory);
    setChatInput("");
    setSending(true);
    setChatError("");

    try {
      const reply = await askGrandmaster(value, history);

      setHistory((previous) => [
        ...previous,
        { role: "assistant", text: reply },
      ]);

      logActivity("Grandmaster AI conversation updated.");
    } catch (error) {
      setChatError(error.message || "AI response unavailable.");
    } finally {
      setSending(false);
    }
  }

  async function copyGenerated() {
    try {
      await navigator.clipboard.writeText(generated);
      setCopied(true);
      setTimeout(() => setCopied(false), 1800);
    } catch {
      setBuildError(
        "Clipboard access unavailable. Select and copy the text manually.",
      );
    }
  }

  function addTask(event) {
    event.preventDefault();

    const title = taskInput.trim();

    if (!title) return;

    setTasks((previous) => [
      {
        id: `${Date.now()}-${Math.random().toString(36).slice(2, 7)}`,
        title,
        done: false,
        createdAt: new Date().toISOString(),
      },
      ...previous,
    ]);

    setTaskInput("");
    logActivity(`Task created: ${title}`);
    setToast("Task added successfully.");
  }

  function toggleTask(id) {
    const task = tasks.find((item) => item.id === id);
    if (!task) return;

    const nextDone = !task.done;

    setTasks((previous) =>
      previous.map((item) =>
        item.id === id ? { ...item, done: nextDone } : item,
      ),
    );
    logActivity(`${nextDone ? "Completed" : "Reopened"} task: ${task.title}`);
  }

  function deleteTask(id) {
    setTasks((previous) => previous.filter((task) => task.id !== id));
    logActivity("Task removed.");
    setToast("Task removed.");
  }

  function toggleStep(number) {
    const exists = completedSteps.includes(number);

    setCompletedSteps((previous) =>
      exists
        ? previous.filter((item) => item !== number)
        : [...previous, number].sort((a, b) => a - b),
    );

    logActivity(
      `Roadmap step ${number} ${exists ? "reopened" : "marked complete"} in local tracker.`,
    );
  }

  function togglePhase(letter) {
    setExpandedPhases((previous) =>
      previous.includes(letter)
        ? previous.filter((item) => item !== letter)
        : [...previous, letter],
    );
  }

  function clearChat() {
    setHistory([
      {
        role: "assistant",
        text: "New conversation started. Grandmaster AI kis kaam mein madad kare?",
      },
    ]);

    setChatError("");
    setToast("New conversation started.");
  }

  function useSuggestion(value) {
    setPrompt(value);
    setPage("builder");
    setTimeout(() => promptRef.current?.focus(), 50);
  }

  function downloadData() {
    const payload = {
      exportedAt: new Date().toISOString(),
      tasks,
      completedSteps,
      activity,
    };

    const blob = new Blob([JSON.stringify(payload, null, 2)], {
      type: "application/json",
    });

    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");

    link.href = url;
    link.download = "grandmaster-project-data.json";
    link.click();

    URL.revokeObjectURL(url);
    setToast("Project data export prepared.");
  }

  function renderOverview() {
    const currentStep = Math.min(completedCount + 1, 100);

    return (
      <>
        <section className="gm-welcome">
          <div>
            <div className="gm-kicker">Central Command · TAJ Edition</div>
            <h1 className="gm-h1">
              Welcome to <span className="gm-gradient">Grandmaster.</span>
            </h1>
            <p className="gm-muted" style={{ margin: 0 }}>
              AI partner, development command center aur business workspace.
            </p>
          </div>

          <button
            className="gm-btn primary"
            onClick={() => navigate("assistant")}
          >
            ✦ Talk to Grandmaster
          </button>
        </section>

        <div className="gm-grid gm-stats">
          <StatCard
            icon="◈"
            title="Roadmap Progress"
            value={`${completedCount}/100`}
            note="Locally tracked completed steps"
          />
          <StatCard
            icon="▣"
            title="My Tasks"
            value={taskCount}
            note={`${finishedTasks} completed · ${taskCount - finishedTasks} remaining`}
          />
          <StatCard
            icon="⬡"
            title="Agent Modules"
            value="20"
            note="Defined modules · live execution unverified"
          />
          <StatCard
            icon="✦"
            title="AI Backend"
            value={
              backend === "LIVE"
                ? "LIVE"
                : backend === "OFF"
                  ? "OFFLINE"
                  : "CHECKING"
            }
            note={backend === "LIVE" ? model : "Actual provider status"}
          />
        </div>

        <div className="gm-grid gm-two">
          <section className="gm-card">
            <SectionHeader
              title="Current Mission"
              subtitle="100-step engineering roadmap"
              action={
                <button
                  className="gm-btn ghost"
                  onClick={() => navigate("roadmap")}
                >
                  View roadmap →
                </button>
              }
            />

            <div
              style={{
                display: "flex",
                gap: 13,
                alignItems: "center",
                marginBottom: 18,
              }}
            >
              <div className="gm-stat-icon" style={{ width: 45, height: 45 }}>
                ◈
              </div>
              <div>
                <div style={{ fontWeight: 800, fontSize: 13 }}>
                  {completedCount === 100
                    ? "All roadmap steps marked complete"
                    : `Step ${currentStep} — ${ROADMAP[currentStep - 1]}`}
                </div>
                <div className="gm-muted gm-small">
                  Actual project health must be checked independently.
                </div>
              </div>
            </div>

            <div className="gm-progress">
              <div
                className="gm-progress-fill"
                style={{ width: `${completedCount}%` }}
              />
            </div>

            <div
              style={{
                display: "flex",
                justifyContent: "space-between",
                marginTop: 8,
              }}
            >
              <span className="gm-muted gm-small">Tracked progress</span>
              <strong className="gm-small">{completedCount}%</strong>
            </div>

            <div className="gm-divider" />

            <div className="gm-notice">
              <strong>Important:</strong> Roadmap checkboxes record your local
              progress. They do not automatically inspect or verify source code.
            </div>
          </section>

          <section className="gm-card">
            <SectionHeader
              title="System Health"
              subtitle="Live backend connectivity check"
              action={
                <button
                  className="gm-btn ghost"
                  onClick={checkHealth}
                  disabled={refreshing}
                >
                  {refreshing ? "Checking…" : "↻ Refresh"}
                </button>
              }
            />

            <div className="gm-list">
              <div className="gm-list-row">
                <span className="gm-row-icon">⌘</span>
                <div className="gm-row-main">
                  <div className="gm-row-title">Backend API</div>
                  <div className="gm-row-sub">/api/health</div>
                </div>
                <StatusPill
                  type={
                    backend === "LIVE"
                      ? "green"
                      : backend === "OFF"
                        ? "red"
                        : ""
                  }
                >
                  {backend}
                </StatusPill>
              </div>

              <div className="gm-list-row">
                <span className="gm-row-icon">✦</span>
                <div className="gm-row-main">
                  <div className="gm-row-title">AI Provider</div>
                  <div className="gm-row-sub">{model}</div>
                </div>
                <StatusPill type={backend === "LIVE" ? "green" : ""}>
                  {backend === "LIVE" ? "API REACHABLE" : "UNVERIFIED"}
                </StatusPill>
              </div>

              <div className="gm-list-row">
                <span className="gm-row-icon">⬢</span>
                <div className="gm-row-main">
                  <div className="gm-row-title">Trading Safety</div>
                  <div className="gm-row-sub">
                    No live trading initiated by this dashboard
                  </div>
                </div>
                <StatusPill type="green">LOCKED</StatusPill>
              </div>
            </div>

            {healthError && (
              <p className="gm-muted gm-small" style={{ marginTop: 12 }}>
                {healthError}
              </p>
            )}
          </section>
        </div>

        <section className="gm-card" style={{ marginBottom: 20 }}>
          <SectionHeader
            title="Quick Actions"
            subtitle="Open a workspace to continue your mission"
          />

          <div className="gm-quick-grid">
            {[
              ["✦", "AI Assistant", "Ask questions or plan work", "assistant"],
              [
                "⌘",
                "App Builder",
                "Generate implementation guidance",
                "builder",
              ],
              ["⬡", "Agent Center", "Review the 20 defined modules", "agents"],
              ["▤", "Roadmap", "Track your 100 development steps", "roadmap"],
              ["▣", "Tasks", "Manage projects and action items", "projects"],
              [
                "⬢",
                "Security",
                "Review operational safety controls",
                "security",
              ],
            ].map(([icon, title, desc, target]) => (
              <button
                className="gm-quick"
                key={target}
                onClick={() => navigate(target)}
              >
                <div className="gm-quick-icon">{icon}</div>
                <div className="gm-quick-title">{title}</div>
                <div className="gm-quick-desc">{desc}</div>
              </button>
            ))}
          </div>
        </section>

        <section className="gm-card">
          <SectionHeader
            title="Recent Activity"
            subtitle="Actions recorded by this dashboard"
          />

          {activity.length === 0 ? (
            <EmptyState>
              No activity recorded yet. Start a task or update a roadmap step.
            </EmptyState>
          ) : (
            <div className="gm-list">
              {activity.slice(0, 5).map((item) => (
                <div className="gm-list-row" key={item.id}>
                  <span className="gm-row-icon">↗</span>
                  <div className="gm-row-main">
                    <div className="gm-row-title">{item.message}</div>
                    <div className="gm-row-sub">{item.time}</div>
                  </div>
                </div>
              ))}
            </div>
          )}
        </section>
      </>
    );
  }

  function renderAssistant() {
    return (
      <>
        <section className="gm-welcome">
          <div>
            <div className="gm-kicker">AI Brain · Conversation Workspace</div>
            <h1 className="gm-h1">
              Grandmaster <span className="gm-gradient">AI</span>
            </h1>
            <p className="gm-muted" style={{ margin: 0 }}>
              Coding, business, learning, planning aur project assistance.
            </p>
          </div>

          <button className="gm-btn" onClick={clearChat}>
            ＋ New chat
          </button>
        </section>

        <div className="gm-notice" style={{ marginBottom: 15 }}>
          AI responses require a working backend and configured provider.
          Conversation history currently remains in this browser session.
        </div>

        <section className="gm-chat">
          <div className="gm-output-head">
            <div>
              <strong>GRANDMASTER AI</strong>
              <div className="gm-muted gm-small">{model}</div>
            </div>
            <StatusPill type={backend === "LIVE" ? "green" : "red"}>
              {backend === "LIVE" ? "CONNECTED" : "UNAVAILABLE"}
            </StatusPill>
          </div>

          <div className="gm-messages">
            {history.map((message, index) => (
              <div
                className={`gm-message ${message.role === "user" ? "user" : "ai"}`}
                key={index}
              >
                {message.text}
              </div>
            ))}

            {sending && (
              <div className="gm-message ai" role="status">
                Grandmaster is thinking…
              </div>
            )}

            <div ref={messagesEndRef} />
          </div>

          {chatError && (
            <div className="gm-notice danger" style={{ margin: 12 }}>
              {chatError}
            </div>
          )}

          <form className="gm-chat-form" onSubmit={sendChat}>
            <textarea
              className="gm-field"
              value={chatInput}
              onChange={(event) => setChatInput(event.target.value)}
              onKeyDown={(event) => {
                if (event.key === "Enter" && !event.shiftKey) {
                  event.preventDefault();
                  sendChat();
                }
              }}
              placeholder="Grandmaster ko apna command dein…"
              aria-label="Message Grandmaster AI"
            />

            <button
              className="gm-btn primary"
              type="submit"
              disabled={sending || backend !== "LIVE" || !chatInput.trim()}
            >
              {sending ? "…" : "➤ Send"}
            </button>
          </form>
        </section>
      </>
    );
  }

  function renderBuilder() {
    return (
      <>
        <section className="gm-welcome">
          <div>
            <div className="gm-kicker">Software Engineering Workspace</div>
            <h1 className="gm-h1">
              AI <span className="gm-gradient">App Builder</span>
            </h1>
            <p className="gm-muted" style={{ margin: 0 }}>
              Apna idea describe karein aur implementation guidance hasil
              karein.
            </p>
          </div>
        </section>

        <section className="gm-builder">
          <div className="gm-card-head">
            <div>
              <h2>What do you want to build?</h2>
              <p>
                Describe the app, features, technology and expected behavior.
              </p>
            </div>
            <span className="gm-stat-icon">⌘</span>
          </div>

          <form
            className="gm-form"
            onSubmit={(event) => {
              event.preventDefault();
              handleBuild();
            }}
          >
            <textarea
              ref={promptRef}
              className="gm-field gm-textarea"
              value={prompt}
              onChange={(event) => setPrompt(event.target.value)}
              placeholder="Example: Improve Grandmaster's React dashboard, preserve existing routes, connect the AI backend securely, add tests, and explain every changed file…"
              aria-label="Application requirements"
            />

            <div
              style={{
                display: "flex",
                justifyContent: "space-between",
                gap: 12,
                flexWrap: "wrap",
              }}
            >
              <span className="gm-muted gm-small">
                {backend === "LIVE"
                  ? "Backend reachable"
                  : "Backend connection required"}
              </span>

              <button
                className="gm-btn primary"
                type="submit"
                disabled={building || !prompt.trim() || backend !== "LIVE"}
              >
                {building ? "Generating…" : "✦ Generate guidance"}
              </button>
            </div>
          </form>

          <div className="gm-suggestions">
            {[
              "Create a browser game using React",
              "Design a Three.js 3D scene",
              "Build a business analytics dashboard",
              "Create an Android app plan",
              "Audit my existing React project",
              "Write tests for the AI backend",
            ].map((item) => (
              <button
                className="gm-chip"
                key={item}
                onClick={() => setPrompt(item)}
              >
                {item}
              </button>
            ))}
          </div>
        </section>

        {buildError && (
          <div
            className="gm-notice danger"
            style={{ marginTop: 15 }}
            role="alert"
          >
            {buildError}
          </div>
        )}

        {generated && (
          <section className="gm-output">
            <div className="gm-output-head">
              <div>
                <strong>AI RESPONSE</strong>
                <div className="gm-muted gm-small">
                  Generated guidance · Not proof of file creation
                </div>
              </div>
              <button className="gm-btn" onClick={copyGenerated}>
                {copied ? "Copied ✓" : "Copy"}
              </button>
            </div>

            <pre>{generated}</pre>
          </section>
        )}

        <div className="gm-notice" style={{ marginTop: 18 }}>
          <strong>Important:</strong> This interface requests AI-generated
          guidance from the configured backend. It does not independently create
          project files, run commands, or deploy applications.
        </div>
      </>
    );
  }

  function renderAgents() {
    return (
      <>
        <section className="gm-welcome">
          <div>
            <div className="gm-kicker">Multi-Agent Architecture</div>
            <h1 className="gm-h1">
              AI <span className="gm-gradient">Agent Center</span>
            </h1>
            <p className="gm-muted" style={{ margin: 0 }}>
              20 planned specialist modules under one central coordinator.
            </p>
          </div>
        </section>

        <div className="gm-notice" style={{ marginBottom: 16 }}>
          <strong>Status policy:</strong> These are module definitions, not
          proof of 20 operational AI agents. An agent becomes operational only
          after its execution workflow and tests are verified.
        </div>

        <div className="gm-grid gm-agent-grid">
          {AGENTS.map(([name, description, code], index) => (
            <article className="gm-agent" key={code}>
              <div className="gm-agent-top">
                <span className="gm-agent-icon">
                  {index === 19 ? "✦" : "⬡"}
                </span>
                <StatusPill>PLANNED</StatusPill>
              </div>
              <h3>{name}</h3>
              <p>{description}</p>
              <div className="gm-divider" />
              <div
                style={{
                  display: "flex",
                  justifyContent: "space-between",
                  alignItems: "center",
                }}
              >
                <span className="gm-muted gm-small">{code}</span>
                <span className="gm-muted gm-small">Not verified</span>
              </div>
            </article>
          ))}
        </div>
      </>
    );
  }

  function renderRoadmap() {
    return (
      <>
        <section className="gm-welcome">
          <div>
            <div className="gm-kicker">Engineering Execution Plan</div>
            <h1 className="gm-h1">
              100-Step <span className="gm-gradient">Roadmap</span>
            </h1>
            <p className="gm-muted" style={{ margin: 0 }}>
              Apne project progress ko track karein. Completion manually
              recorded hoti hai.
            </p>
          </div>

          <button className="gm-btn" onClick={() => setCompletedSteps([])}>
            Reset tracking
          </button>
        </section>

        <div className="gm-card" style={{ marginBottom: 16 }}>
          <div
            style={{
              display: "flex",
              justifyContent: "space-between",
              gap: 12,
              marginBottom: 12,
            }}
          >
            <strong>Tracked completion</strong>
            <strong className="gm-gradient">{completedCount}/100</strong>
          </div>
          <div className="gm-progress">
            <div
              className="gm-progress-fill"
              style={{ width: `${completedCount}%` }}
            />
          </div>
          <p className="gm-muted gm-small" style={{ marginBottom: 0 }}>
            Checking a box updates this browser's roadmap tracker; it does not
            run tests.
          </p>
        </div>

        {PHASES.map(([letter, title, start, end]) => {
          const phaseSteps = ROADMAP.slice(start - 1, end);
          const phaseDone = phaseSteps.filter((_, i) =>
            completedSteps.includes(start + i),
          ).length;
          const open = expandedPhases.includes(letter);

          return (
            <section className="gm-roadmap-phase" key={letter}>
              <button
                className="gm-phase-head"
                onClick={() => togglePhase(letter)}
                aria-expanded={open}
              >
                <span className="gm-phase-letter">{letter}</span>
                <span className="gm-phase-main">
                  <strong>{title}</strong>
                  <span>
                    Steps {start}–{end} · {phaseDone}/10 tracked complete
                  </span>
                </span>
                <span className="gm-muted">{open ? "−" : "+"}</span>
              </button>

              {open && (
                <div className="gm-phase-body">
                  {phaseSteps.map((step, index) => {
                    const number = start + index;
                    const checked = completedSteps.includes(number);

                    return (
                      <label className="gm-step" key={number}>
                        <span className="gm-step-num">
                          {String(number).padStart(2, "0")}
                        </span>
                        <span
                          className="gm-step-title"
                          style={
                            checked ? { color: "var(--green)" } : undefined
                          }
                        >
                          {step}
                        </span>
                        <input
                          type="checkbox"
                          checked={checked}
                          onChange={() => toggleStep(number)}
                          aria-label={`Mark roadmap step ${number}: ${step}`}
                        />
                      </label>
                    );
                  })}
                </div>
              )}
            </section>
          );
        })}
      </>
    );
  }

  function renderProjects() {
    return (
      <>
        <section className="gm-welcome">
          <div>
            <div className="gm-kicker">Project Operations</div>
            <h1 className="gm-h1">
              Projects <span className="gm-gradient">& Tasks</span>
            </h1>
            <p className="gm-muted" style={{ margin: 0 }}>
              Create tasks and track their completion in this browser.
            </p>
          </div>

          <button className="gm-btn" onClick={downloadData}>
            ↓ Export data
          </button>
        </section>

        <section className="gm-card">
          <SectionHeader
            title="Create a Task"
            subtitle="Tasks are stored locally in this browser."
          />

          <form
            onSubmit={addTask}
            style={{ display: "flex", gap: 10, flexWrap: "wrap" }}
          >
            <input
              className="gm-field"
              style={{ flex: "1 1 230px" }}
              value={taskInput}
              onChange={(event) => setTaskInput(event.target.value)}
              placeholder="Example: Verify Grandmaster AI chat..."
              aria-label="New task title"
              maxLength={250}
            />
            <button
              className="gm-btn primary"
              type="submit"
              disabled={!taskInput.trim()}
            >
              + Add task
            </button>
          </form>

          <div className="gm-divider" />

          <SectionHeader
            title="Task List"
            subtitle={`${finishedTasks} completed of ${taskCount} total tasks`}
          />

          {tasks.length === 0 ? (
            <EmptyState>No tasks yet. Add your first mission above.</EmptyState>
          ) : (
            tasks.map((task) => (
              <div
                className={`gm-task ${task.done ? "done" : ""}`}
                key={task.id}
              >
                <input
                  type="checkbox"
                  checked={task.done}
                  onChange={() => toggleTask(task.id)}
                  aria-label={`Mark ${task.title} complete`}
                />
                <div className="gm-task-text">{task.title}</div>
                <button
                  className="gm-btn ghost danger"
                  onClick={() => deleteTask(task.id)}
                >
                  Delete
                </button>
              </div>
            ))
          )}
        </section>

        <div className="gm-notice" style={{ marginTop: 15 }}>
          Local storage is not a cloud database. Tasks may not appear on another
          device or browser. Use export to keep a copy of the current records.
        </div>
      </>
    );
  }

  function renderBusiness() {
    return (
      <>
        <section className="gm-welcome">
          <div>
            <div className="gm-kicker">Business & Productivity</div>
            <h1 className="gm-h1">
              Business <span className="gm-gradient">Center</span>
            </h1>
            <p className="gm-muted" style={{ margin: 0 }}>
              Manage business planning, content, learning and operational
              priorities.
            </p>
          </div>
        </section>

        <div className="gm-grid gm-agent-grid">
          {[
            [
              "↗",
              "Business Planning",
              "Create business plans, research markets and prioritize ideas.",
              "assistant",
              "AI assistance",
            ],
            [
              "▤",
              "Learning Center",
              "Organize learning goals and practical lessons.",
              "projects",
              "Task tracking",
            ],
            [
              "✎",
              "Content Studio",
              "Generate drafts, scripts and content calendars.",
              "assistant",
              "AI assistance",
            ],
            [
              "▣",
              "Project Management",
              "Record tasks, milestones and progress.",
              "projects",
              "Available locally",
            ],
            [
              "◈",
              "Analytics Planning",
              "Design metrics and reporting requirements.",
              "assistant",
              "AI assistance",
            ],
            [
              "⬡",
              "Automation Planning",
              "Design workflows before enabling external actions.",
              "integrations",
              "Connection required",
            ],
          ].map(([icon, title, description, target, status]) => (
            <article className="gm-agent" key={title}>
              <div className="gm-agent-top">
                <span className="gm-agent-icon">{icon}</span>
                <StatusPill>{status}</StatusPill>
              </div>
              <h3>{title}</h3>
              <p>{description}</p>
              <button className="gm-btn" onClick={() => navigate(target)}>
                Open workspace →
              </button>
            </article>
          ))}
        </div>
      </>
    );
  }

  function renderIntegrations() {
    const integrations = [
      [
        "AI Provider",
        "Server-side AI connection",
        "Backend health can be checked; provider functionality needs a chat test.",
      ],
      [
        "Database",
        "Persistent project storage",
        "No database connection is verified by this dashboard.",
      ],
      [
        "Social Media",
        "Authorized content publishing and analytics",
        "Official APIs, account permissions and approval workflows required.",
      ],
      [
        "Binance",
        "Read-only market research",
        "Live data connection is not configured by this dashboard.",
      ],
      [
        "MT5 / Exness",
        "Read-only trading monitoring",
        "Broker connectivity must be implemented and verified separately.",
      ],
      [
        "Automation",
        "Approved scheduled workflows",
        "Automation engine and permissions are not verified.",
      ],
      [
        "Deployment",
        "Production hosting",
        "A successful local build does not prove production health.",
      ],
    ];

    return (
      <>
        <section className="gm-welcome">
          <div>
            <div className="gm-kicker">External Services</div>
            <h1 className="gm-h1">
              System <span className="gm-gradient">Integrations</span>
            </h1>
            <p className="gm-muted" style={{ margin: 0 }}>
              Review requirements before connecting external accounts or
              services.
            </p>
          </div>
        </section>

        <div className="gm-notice" style={{ marginBottom: 16 }}>
          No integration is marked CONNECTED unless its connection has been
          verified. This dashboard does not request your passwords or expose API
          keys.
        </div>

        <section className="gm-card">
          <div className="gm-list">
            {integrations.map(([name, subtitle, description]) => (
              <div className="gm-list-row" key={name}>
                <span className="gm-row-icon">⌘</span>
                <div className="gm-row-main">
                  <div className="gm-row-title">{name}</div>
                  <div className="gm-row-sub">{subtitle}</div>
                  <div className="gm-muted gm-small" style={{ marginTop: 6 }}>
                    {description}
                  </div>
                </div>
                <StatusPill>UNVERIFIED</StatusPill>
              </div>
            ))}
          </div>
        </section>
      </>
    );
  }

  function renderSecurity() {
    const controls = [
      ["Real trading", "LOCKED", "This UI does not submit live trades."],
      [
        "Money movement",
        "DISABLED",
        "No money transfer functionality is implemented here.",
      ],
      [
        "API credentials",
        "SERVER-SIDE ONLY",
        "Never place private API keys in React source code.",
      ],
      [
        "Social publishing",
        "APPROVAL REQUIRED",
        "Verify account permissions and review external actions.",
      ],
      [
        "AI provider",
        backend === "LIVE" ? "BACKEND REACHABLE" : "UNAVAILABLE",
        "A health response does not guarantee successful model inference.",
      ],
      [
        "Project storage",
        "BROWSER LOCAL",
        "Tasks and roadmap tracking use localStorage, not cloud storage.",
      ],
      [
        "Deployment",
        "NOT VERIFIED",
        "Production status requires a separate deployed-site check.",
      ],
    ];

    return (
      <>
        <section className="gm-welcome">
          <div>
            <div className="gm-kicker">Security & Operational Controls</div>
            <h1 className="gm-h1">
              Safety <span className="gm-gradient">Center</span>
            </h1>
            <p className="gm-muted" style={{ margin: 0 }}>
              Honest status reporting, credential safety and external-action
              boundaries.
            </p>
          </div>
        </section>

        <div className="gm-notice danger" style={{ marginBottom: 16 }}>
          <strong>Safety rule:</strong> Do not put private API keys, passwords,
          broker credentials or financial account secrets in frontend code. Use
          server-side environment variables and appropriate access controls.
        </div>

        <section className="gm-card">
          <SectionHeader
            title="Operational Controls"
            subtitle="Status shown by this interface"
          />

          <div className="gm-list">
            {controls.map(([name, status, description]) => (
              <div className="gm-list-row" key={name}>
                <span className="gm-row-icon">⬢</span>
                <div className="gm-row-main">
                  <div className="gm-row-title">{name}</div>
                  <div className="gm-row-sub">{description}</div>
                </div>
                <StatusPill
                  type={
                    status === "LOCKED" || status === "DISABLED" ? "green" : ""
                  }
                >
                  {status}
                </StatusPill>
              </div>
            ))}
          </div>
        </section>
      </>
    );
  }

  const pageTitles = {
    overview: "Command Center",
    assistant: "Grandmaster AI",
    builder: "App Builder",
    agents: "AI Agent Center",
    roadmap: "100-Step Roadmap",
    projects: "Projects & Tasks",
    business: "Business Center",
    integrations: "Integrations",
    security: "Security Center",
  };

  const renderers = {
    overview: renderOverview,
    assistant: renderAssistant,
    builder: renderBuilder,
    agents: renderAgents,
    roadmap: renderRoadmap,
    projects: renderProjects,
    business: renderBusiness,
    integrations: renderIntegrations,
    security: renderSecurity,
  };

  return (
    <div className="gm">
      <style>{css}</style>

      {menuOpen && (
        <button
          aria-label="Close navigation"
          onClick={() => setMenuOpen(false)}
          style={{
            position: "fixed",
            inset: 0,
            zIndex: 25,
            border: 0,
            background: "#0009",
          }}
        />
      )}

      <div className="gm-layout">
        <aside className={`gm-sidebar ${menuOpen ? "open" : ""}`}>
          <div className="gm-brand">
            <div className="gm-logo" aria-hidden="true">
              G
            </div>
            <div>
              <div className="gm-brand-name">Grandmaster</div>
              <div className="gm-brand-sub">DIGITAL HUB</div>
            </div>
          </div>

          <div className="gm-section-label">COMMAND</div>

          <nav className="gm-nav" aria-label="Main navigation">
            {NAVIGATION.map((item) => (
              <button
                key={item.id}
                className={page === item.id ? "active" : ""}
                onClick={() => navigate(item.id)}
                aria-current={page === item.id ? "page" : undefined}
              >
                <span className="gm-nav-icon">{item.icon}</span>
                <span>{item.label}</span>
              </button>
            ))}
          </nav>

          <div className="gm-sidebar-bottom">
            <div className="gm-safety-mini">
              <div className="gm-safety-title">
                <span>●</span> SAFETY CONTROLS
              </div>
              <p>
                Trading locked by default.
                <br />
                Money movement disabled.
                <br />
                External actions require approval.
              </p>
            </div>

            <div
              className="gm-muted gm-small"
              style={{ padding: "15px 7px 0" }}
            >
              Grandmaster Digital Hub
              <br />
              TAJ Edition · 2026
            </div>
          </div>
        </aside>

        <div className="gm-main">
          <header className="gm-topbar">
            <div className="gm-top-left">
              <button
                className="gm-icon-btn gm-menu-toggle"
                onClick={() => setMenuOpen((value) => !value)}
                aria-label="Toggle navigation"
                aria-expanded={menuOpen}
              >
                ☰
              </button>

              <div>
                <div className="gm-eyebrow">Grandmaster HQ / Workspace</div>
                <div className="gm-page-title">{pageTitles[page]}</div>
              </div>
            </div>

            <div className="gm-top-right">
              <div
                className={`gm-status ${backend === "LIVE" ? "live" : backend === "OFF" ? "off" : ""}`}
                role="status"
              >
                <span className="gm-dot" />
                <span className="gm-status-label">
                  {backend === "LIVE"
                    ? "Backend live"
                    : backend === "OFF"
                      ? "Backend offline"
                      : "Connecting"}
                </span>
              </div>

              <button
                className="gm-icon-btn"
                onClick={checkHealth}
                disabled={refreshing}
                title="Refresh backend status"
                aria-label="Refresh backend status"
              >
                {refreshing ? "…" : "↻"}
              </button>
            </div>
          </header>

          <main className="gm-content">
            {renderers[page]?.() || renderOverview()}

            <footer className="gm-footer">
              GRANDMASTER DIGITAL HUB · LEARN · BUILD · EARN
              <br />
              UI status is not proof of backend, agent, integration or
              production functionality.
            </footer>
          </main>
        </div>
      </div>

      {toast && (
        <div className="gm-toast" role="status">
          {toast}
        </div>
      )}
    </div>
  );
}
