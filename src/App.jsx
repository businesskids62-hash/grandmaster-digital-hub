import {
  Component,
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import { hamzad } from "./agents/hamzad.js";
import { systemDimagh } from "./agents/systemDimagh.js";
import { doubleBrain } from "./agents/doubleBrain.js";
import { systemDoctor } from "./agents/systemDoctor.js";
import { agentOrchestrator } from "./agents/agentOrchestrator.js";
import { startWakeWord, speakRoar } from "./utils/wakeWord.js";
import AgentDesks from "./pages/AgentDesks.jsx";


/* ==========================================================================
   GRANDMASTER DIGITAL HUB — Generation 5
   Single self-contained file. No external hooks/components required.
   Backend contract:
     GET  /api/health -> { primary?: string, model?: string }
     POST /api/chat   -> { reply | response | text: string, model?: string }
     POST body: { message, history, attachments, agent, memory, system }
   Set window.GRANDMASTER_API_BASE in index.html to use another backend.
   ========================================================================== */

const API_BASE = (
  (typeof window !== "undefined" && window.GRANDMASTER_API_BASE) ||
  (typeof import.meta !== "undefined" && import.meta.env?.VITE_API_URL) ||
  ""
).replace(/\/$/, "");
const DEFAULT_MODEL = "AI Provider";
const STORAGE_PREFIX = "gm5:";
const STORAGE_KEYS = {
  currentModel: "gm5:currentModel",
  providerStatus: "gm5:providerStatus",
  chatHistory: "gm5:chatHistory",
  uiPrefs: "gm5:uiPrefs",
  build: "gm5:build",
};
const BUILD_INFO =
  typeof __BUILD_INFO__ !== "undefined"
    ? __BUILD_INFO__
    : { commitSha: "dev", buildTime: new Date().toISOString() };
const STORAGE_KEY = "grandmaster_dashboard_v5";
const REQUEST_TIMEOUT_MS = 90000;
const CHAT_TIMEOUT_MS = 30000; // chat must answer within 30s or show an error
const SAFE_FETCH_JSON_TIMEOUT_MS = 15000;

// Helper: fetch JSON with proper error handling
async function safeFetchJson(input, init = {}, timeoutMs = SAFE_FETCH_JSON_TIMEOUT_MS) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const response = await fetch(input, { ...init, signal: controller.signal });
    clearTimeout(timer);
    if (!response.ok) {
      const bodyText = await response.text().catch(() => "No response body");
      return {
        ok: false,
        error: `HTTP ${response.status}: ${response.statusText}`,
        body: bodyText.substring(0, 200),
      };
    }
    // Check content-type is JSON
    const contentType = response.headers.get("content-type") || "";
    if (!contentType.includes("application/json")) {
      const bodyText = await response.text().catch(() => "No response body");
      return {
        ok: false,
        error: `Expected application/json but got: ${contentType.trim()}`,
        body: bodyText.substring(0, 200),
      };
    }
    const data = await response.json();
    return { ok: true, data };
  } catch (error) {
    clearTimeout(timer);
    if (error.name === "AbortError") {
      return { ok: false, error: `Request timed out after ${timeoutMs}ms` };
    }
    return { ok: false, error: error.message || "Fetch failed" };
  }
}

const MAX_FILES = 5;
const MAX_FILE_BYTES = 8 * 1024 * 1024;
const MAX_HISTORY_SAVED = 100;
const MAX_MEMORY_SENT = 20;
// true  = agent role + memory are also written into the message text, so they
//         work even if your backend ignores the extra fields.
// false = send only the structured fields (agent, memory, system).
const INLINE_CONTEXT = true;

const GREETING = {
  id: "greeting",
  role: "assistant",
  text: "Assalamu Alaikum! Main Grandmaster AI hoon. Main aapke projects, coding, business planning aur roadmap mein madad kar sakta hoon. Aaj kis mission par kaam karein?",
};

const NAVIGATION = [
  { id: "overview", icon: "◈", label: "Command Center" },
  { id: "assistant", icon: "✦", label: "Grandmaster AI" },
  { id: "memory", icon: "◉", label: "Memory" },
  { id: "builder", icon: "⌘", label: "App Builder" },
  { id: "agents", icon: "⬡", label: "AI Team" },
  { id: "desks", icon: "⌬", label: "Agent Operations" },
  { id: "roadmap", icon: "▤", label: "100-Step Roadmap" },
  { id: "projects", icon: "▣", label: "Projects & Tasks" },
  { id: "business", icon: "↗", label: "Business Center" },
  { id: "integrations", icon: "⬣", label: "Integrations" },
  { id: "security", icon: "⬢", label: "Security Center" },
];

const PAGE_TITLES = Object.fromEntries(NAVIGATION.map((n) => [n.id, n.label]));

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
].map(([name, description, code]) => ({ name, description, code }));

const DEFAULT_AGENT = "MASTER";

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

const LISTEN_LANGS = [
  ["ur-PK", "Urdu"],
  ["en-US", "English"],
  ["hi-IN", "Hindi"],
];

/* ------------------------------- utilities ------------------------------- */

const uid = () => `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
const nowLabel = () => new Date().toLocaleString();

function loadState() {
  const empty = {
    tasks: [],
    completedSteps: [],
    activity: [],
    memories: [],
    history: [GREETING],
    agentCode: DEFAULT_AGENT,
    autoSpeak: false,
  };
  try {
    if (typeof localStorage !== "undefined") {
      // Ensure no auth secrets exist in localStorage (Rule 2)
      localStorage.removeItem("authToken");
      localStorage.removeItem("token");
      localStorage.removeItem("jwt");
      localStorage.setItem(STORAGE_KEYS.build, JSON.stringify(BUILD_INFO));
    }

    // Load gm5:chatHistory
    let history = [];
    const savedChat = localStorage.getItem(STORAGE_KEYS.chatHistory);
    if (savedChat) {
      const parsedChat = JSON.parse(savedChat);
      if (Array.isArray(parsedChat)) {
        history = parsedChat
          .filter(
            (m) =>
              m &&
              typeof m.text === "string" &&
              (m.role === "user" || m.role === "assistant"),
          )
          .slice(-MAX_HISTORY_SAVED);
      }
    }

    // Load gm5:uiPrefs
    const savedPrefs = localStorage.getItem(STORAGE_KEYS.uiPrefs);
    if (savedPrefs) {
      const prefs = JSON.parse(savedPrefs);
      return {
        tasks: Array.isArray(prefs.tasks) ? prefs.tasks : [],
        completedSteps: Array.isArray(prefs.completedSteps)
          ? prefs.completedSteps.filter(
              (n) => Number.isInteger(n) && n >= 1 && n <= 100,
            )
          : [],
        activity: Array.isArray(prefs.activity) ? prefs.activity.slice(0, 30) : [],
        memories: Array.isArray(prefs.memories)
          ? prefs.memories.filter((m) => m && m.text)
          : [],
        history: history.length ? history : [GREETING],
        agentCode: AGENTS.some((a) => a.code === prefs.agentCode)
          ? prefs.agentCode
          : DEFAULT_AGENT,
        autoSpeak: Boolean(prefs.autoSpeak),
      };
    }

    // Fallback migration from legacy storage key
    const v = JSON.parse(localStorage.getItem(STORAGE_KEY) || "null");
    if (!v || typeof v !== "object") return empty;
    const legacyHistory = Array.isArray(v.history)
      ? v.history.filter(
          (m) =>
            m &&
            typeof m.text === "string" &&
            (m.role === "user" || m.role === "assistant"),
        )
      : [];
    return {
      tasks: Array.isArray(v.tasks) ? v.tasks : [],
      completedSteps: Array.isArray(v.completedSteps)
        ? v.completedSteps.filter(
            (n) => Number.isInteger(n) && n >= 1 && n <= 100,
          )
        : [],
      activity: Array.isArray(v.activity) ? v.activity.slice(0, 30) : [],
      memories: Array.isArray(v.memories)
        ? v.memories.filter((m) => m && m.text)
        : [],
      history: legacyHistory.length ? legacyHistory.slice(-MAX_HISTORY_SAVED) : [GREETING],
      agentCode: AGENTS.some((a) => a.code === v.agentCode)
        ? v.agentCode
        : DEFAULT_AGENT,
      autoSpeak: Boolean(v.autoSpeak),
    };
  } catch {
    return empty;
  }
}

function fileToBase64(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result).split(",")[1] || "");
    reader.onerror = () => reject(new Error("File read failed."));
    reader.readAsDataURL(file);
  });
}

function stripForSpeech(text) {
  return String(text)
    .replace(/```[\s\S]*?```/g, " code block. ")
    .replace(/[*_`#>~]/g, "")
    .replace(/\[(.*?)\]\(.*?\)/g, "$1")
    .slice(0, 3000);
}

async function apiRequest(path, options = {}, timeoutMs = REQUEST_TIMEOUT_MS) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
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
      let detail = "";
      try {
        const body = await response.json();
        detail = body?.error ? `: ${body.error}` : "";
      } catch {
        /* non-JSON error body */
      }
      throw new Error(`Request failed (${response.status})${detail}`);
    }
    return await response.json();
  } catch (error) {
    if (error.name === "AbortError")
      throw new Error("Request timed out. Dobara try karein.");
    throw error;
  } finally {
    clearTimeout(timer);
  }
}

function buildContext(agent, memories) {
  const mem = [...memories]
    .sort((a, b) => Number(b.pinned) - Number(a.pinned) || b.time - a.time)
    .slice(0, MAX_MEMORY_SENT)
    .map((m) => m.text);
  const system =
    `You are Grandmaster AI acting as the ${agent.name} (${agent.description}). ` +
    `Reply in the user's language (Urdu/Roman Urdu/English). Be accurate, practical and honest. ` +
    `Never claim files were written, tests run or deployments done unless a tool confirms it.`;
  return { mem, system };
}

async function askGrandmaster(
  message,
  history = [],
  files = [],
  { agent, memories = [], timeoutMs = CHAT_TIMEOUT_MS } = {},
) {
  const attachments = await Promise.all(
    files.map(async (item) => {
      const file = item.file || item;
      return {
        name: file.name,
        type: file.type,
        data: await fileToBase64(file),
      };
    }),
  );
  const { mem, system } = buildContext(
    agent || AGENTS[AGENTS.length - 1],
    memories,
  );
  const text = INLINE_CONTEXT
    ? `[ROLE]\n${system}\n${mem.length ? `[MEMORY]\n- ${mem.join("\n- ")}\n` : ""}[USER]\n${message}`
    : message;

  const data = await apiRequest(
    "/api/chat",
    {
      method: "POST",
      body: JSON.stringify({
        message: text,
        attachments,
        agent: agent ? agent.code : DEFAULT_AGENT,
        memory: mem,
        system,
        history: history.slice(-12).map((item) => ({
          role: item.role === "user" ? "user" : "assistant",
          content: item.text,
        })),
      }),
    },
    timeoutMs,
  );

  const reply = [data?.reply, data?.response, data?.text, data?.message].find(
    (v) => typeof v === "string" && v.trim(),
  );
  if (!reply) throw new Error("Backend ne koi jawab nahi diya.");
  return { text: reply, model: data.model || data.primary || "" };
}

/* ---------------------------------- hooks --------------------------------- */

function useVoice({
  listenLang = "ur-PK",
  speakLang = "en-IN",
  initialAuto = false,
} = {}) {
  const SR =
    typeof window !== "undefined"
      ? window.SpeechRecognition || window.webkitSpeechRecognition
      : null;
  const ttsSupported =
    typeof window !== "undefined" && "speechSynthesis" in window;
  const sttSupported = Boolean(SR);

  const [listening, setListening] = useState(false);
  const [interim, setInterim] = useState("");
  const [speaking, setSpeaking] = useState(false);
  const [autoSpeak, setAutoSpeak] = useState(initialAuto);
  const [voiceError, setVoiceError] = useState("");
  const recRef = useRef(null);

  const stopListening = useCallback(() => {
    try {
      recRef.current?.stop();
    } catch {
      /* already stopped */
    }
  }, []);

  const startListening = useCallback(
    (onFinal, langOverride) => {
      if (!SR) {
        setVoiceError(
          "Is browser mein mic support nahi. Chrome ya Edge use karein.",
        );
        return;
      }
      setVoiceError("");
      try {
        recRef.current?.abort();
      } catch {
        /* ignore */
      }
      const rec = new SR();
      rec.lang = langOverride || listenLang;
      rec.interimResults = true;
      rec.continuous = false;
      rec.maxAlternatives = 1;
      let finalText = "";
      rec.onstart = () => setListening(true);
      rec.onresult = (event) => {
        let interimText = "";
        for (let i = event.resultIndex; i < event.results.length; i += 1) {
          const piece = event.results[i][0].transcript;
          if (event.results[i].isFinal) finalText += piece;
          else interimText += piece;
        }
        setInterim(interimText);
      };
      rec.onerror = (event) => {
        const map = {
          "not-allowed":
            "Mic permission block hai. Browser settings mein allow karein.",
          "service-not-allowed":
            "Mic permission block hai. Browser settings mein allow karein.",
          "no-speech": "Awaaz sunai nahi di. Dobara try karein.",
          "audio-capture": "Mic nahi mila. Device check karein.",
          network: "Voice service ke liye internet chahiye.",
        };
        if (event.error !== "aborted")
          setVoiceError(map[event.error] || `Voice error: ${event.error}`);
      };
      rec.onend = () => {
        setListening(false);
        setInterim("");
        if (finalText.trim()) onFinal?.(finalText.trim());
        recRef.current = null;
      };
      recRef.current = rec;
      try {
        rec.start();
      } catch {
        setListening(false);
      }
    },
    [SR, listenLang],
  );

  const stopSpeaking = useCallback(() => {
    if (ttsSupported) window.speechSynthesis.cancel();
    setSpeaking(false);
  }, [ttsSupported]);

  const speak = useCallback(
    (text) => {
      if (!ttsSupported || !text) return;
      window.speechSynthesis.cancel();
      const utter = new SpeechSynthesisUtterance(stripForSpeech(text));
      utter.lang = speakLang;
      utter.onstart = () => setSpeaking(true);
      utter.onend = () => setSpeaking(false);
      utter.onerror = () => setSpeaking(false);
      window.speechSynthesis.speak(utter);
    },
    [ttsSupported, speakLang],
  );

  useEffect(
    () => () => {
      try {
        recRef.current?.abort();
      } catch {
        /* ignore */
      }
      if (ttsSupported) window.speechSynthesis.cancel();
    },
    [ttsSupported],
  );

  return {
    listening,
    interim,
    speaking,
    autoSpeak,
    setAutoSpeak,
    voiceError,
    setVoiceError,
    sttSupported,
    ttsSupported,
    startListening,
    stopListening,
    speak,
    stopSpeaking,
  };
}

function useAttachments() {
  const [files, setFiles] = useState([]);
  const [error, setError] = useState("");

  const add = useCallback((picked) => {
    const list = Array.from(picked || []);
    setError("");
    setFiles((prev) => {
      const next = [...prev];
      for (const file of list) {
        if (next.length >= MAX_FILES) {
          setError(`Maximum ${MAX_FILES} files allowed.`);
          break;
        }
        if (file.size > MAX_FILE_BYTES) {
          setError(`${file.name} bohat bari hai (max 8 MB).`);
          continue;
        }
        next.push({ id: uid(), file });
      }
      return next;
    });
  }, []);

  const remove = useCallback(
    (id) => setFiles((prev) => prev.filter((f) => f.id !== id)),
    [],
  );
  const clear = useCallback(() => {
    setFiles([]);
    setError("");
  }, []);
  return { files, error, add, remove, clear };
}

function AttachButton({ onPick, disabled }) {
  const inputRef = useRef(null);
  return (
    <>
      <input
        ref={inputRef}
        type="file"
        multiple
        hidden
        accept="image/*,.pdf,.txt,.md,.json,.csv,.js,.jsx,.ts,.tsx,.py,.html,.css"
        onChange={(e) => {
          onPick(e.target.files);
          e.target.value = "";
        }}
      />
      <button
        type="button"
        className="gm-btn"
        disabled={disabled}
        onClick={() => inputRef.current?.click()}
        aria-label="Attach files"
        title="File attach karein"
      >
        📎
      </button>
    </>
  );
}

/* ---------------------------- small components ---------------------------- */

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

function PageHead({ kicker, title, accent, subtitle, action }) {
  return (
    <section className="gm-welcome">
      <div>
        <div className="gm-kicker">{kicker}</div>
        <h1 className="gm-h1">
          {title} <span className="gm-gradient">{accent}</span>
        </h1>
        <p className="gm-muted" style={{ margin: 0 }}>
          {subtitle}
        </p>
      </div>
      {action}
    </section>
  );
}

class ErrorBoundary extends Component {
  constructor(props) {
    super(props);
    this.state = { error: null };
  }
  static getDerivedStateFromError(error) {
    return { error };
  }
  componentDidCatch(error, info) {
    // eslint-disable-next-line no-console
    console.error("Grandmaster UI error:", error, info);
  }
  render() {
    if (!this.state.error) return this.props.children;
    return (
      <div className="gm" style={{ padding: 30 }}>
        <style>{css}</style>
        <div className="gm-notice danger" role="alert">
          <strong>Something went wrong.</strong>{" "}
          {String(this.state.error.message || this.state.error)}
          <div style={{ marginTop: 12, display: "flex", gap: 8 }}>
            <button
              className="gm-btn"
              onClick={() => this.setState({ error: null })}
            >
              Try again
            </button>
            <button
              className="gm-btn danger"
              onClick={() => {
                localStorage.removeItem(STORAGE_KEY);
                window.location.reload();
              }}
            >
              Reset saved data
            </button>
          </div>
        </div>
      </div>
    );
  }
}

/* ----------------------------------- App ---------------------------------- */

function App() {
  const saved = useMemo(loadState, []);
  const voice = useVoice({
    listenLang: "ur-PK",
    speakLang: "en-IN",
    initialAuto: saved.autoSpeak,
  });
  const att = useAttachments();

  const [page, setPage] = useState("overview");
  const [menuOpen, setMenuOpen] = useState(false);
  const [backend, setBackend] = useState("CHECKING");
  const [model, setModel] = useState(DEFAULT_MODEL);
  const [healthError, setHealthError] = useState("");
  const [aiStatus, setAiStatus] = useState("UNKNOWN"); // UNKNOWN | VERIFIED | FAILED
  const [aiReason, setAiReason] = useState("");
  const [refreshing, setRefreshing] = useState(false);
  const [toast, setToast] = useState("");

  const [agentCode, setAgentCode] = useState(saved.agentCode);
  const [listenLang, setListenLang] = useState("ur-PK");

  const [prompt, setPrompt] = useState("");
  const [building, setBuilding] = useState(false);
  const [generated, setGenerated] = useState("");
  const [buildError, setBuildError] = useState("");
  const [copied, setCopied] = useState(false);

  const [teamTask, setTeamTask] = useState("");
  const [teamRunning, setTeamRunning] = useState(false);
  const [teamOutput, setTeamOutput] = useState("");
  const [teamError, setTeamError] = useState("");

  const [chatInput, setChatInput] = useState("");
  const [sending, setSending] = useState(false);
  const [chatError, setChatError] = useState("");
  /* ---- MERE SHER wake word state ---- */
  const [isListening, setIsListening] = useState(false);
  const [isTriggered, setIsTriggered] = useState(false);
  const [doctorScan, setDoctorScan] = useState(null);
  const [doctorRunning, setDoctorRunning] = useState(false);
  const [dimaghLogs, setDimaghLogs] = useState([]);
  const [hamzadSaved, setHamzadSaved] = useState(hamzad.getSnapshot().updatedAt ? true : false);
  const [weaknessesInput, setWeaknessesInput] = useState("");
  const [roadmapLocked, setRoadmapLocked] = useState(hamzad.isTarteebLocked());
  const wakeRef = useRef(null);

  const addDimaghLog = (message) => {
    const entry = `[Dimagh] ${message}`;
    setDimaghLogs((prev) => [entry, ...prev].slice(0, 60));
    systemDimagh.addLog(message);
  };

  const toggleWake = () => {
    if (isListening) {
      if (wakeRef.current) wakeRef.current.stop();
      setIsListening(false);
      setIsTriggered(false);
      addDimaghLog("Mic roka gaya");
    } else {
      if (wakeRef.current) {
        setIsListening(true);
        addDimaghLog("Pehle se chalu hai");
        return;
      }
      wakeRef.current = startWakeWord({
        onTrigger: (state) => {
          setIsTriggered(true);
          setIsListening(true);
          addDimaghLog("Wake word 'Mere Sher' detected — dono brains zinda");
          // Also announce via agent orchestrator
          agentOrchestrator.log("CODING", "working");
          agentOrchestrator.log("RESEARCH", "working");
          setTimeout(() => setIsTriggered(false), 6000);
        },
      });
      setIsListening(true);
      addDimaghLog("Mic ON — 'Mere Sher' ke liye sun raha hoon");
    }
  };

  /* ---- System Doctor: virus scan & disk cleanup ---- */
  const runSystemDoctor = () => {
    setDoctorRunning(true);
    addDimaghLog("SystemDoctor: virus scan aur disk cleanup shuru ho raha hai");
    agentOrchestrator.log("SECURITY", "working");
    systemDoctor.runVirusScan();
    systemDoctor.runDiskCleanup();
    setTimeout(() => {
      setDoctorRunning(false);
      setDoctorScan(systemDoctor.getSnapshot());
      addDimaghLog(
        `SystemDoctor: scan complete — ${systemDoctor.getSnapshot().threats.length} threat(s), ${systemDoctor.getSnapshot().junkFiles.length} file(s)`,
      );
    }, 2500);
  };

  /* Mic always ON: start wake word on mount */
  useEffect(() => {
    toggleWake();
    return () => {
      if (wakeRef.current) wakeRef.current.stop();
    };
  }, []);

  const [history, setHistory] = useState(saved.history);

  const [memories, setMemories] = useState(saved.memories);
  const [memoryInput, setMemoryInput] = useState("");

  const [taskInput, setTaskInput] = useState("");
  const [tasks, setTasks] = useState(saved.tasks);
  const [completedSteps, setCompletedSteps] = useState(saved.completedSteps);
  const [activity, setActivity] = useState(saved.activity);
  const [expandedPhases, setExpandedPhases] = useState(["A"]);

  const messagesEndRef = useRef(null);
  const mounted = useRef(true);

  const agent =
    AGENTS.find((a) => a.code === agentCode) || AGENTS[AGENTS.length - 1];
  const completedCount = completedSteps.length;
  const taskCount = tasks.length;
  const finishedTasks = tasks.filter((t) => t.done).length;

  useEffect(
    () => () => {
      mounted.current = false;
    },
    [],
  );

  // Persist gm5: versioned keys (cap 100, no attachments/base64, no auth secrets)
  useEffect(() => {
    try {
      // 1. gm5:chatHistory - cap 100, strip attachments & base64
      const cleanHistory = history
        .slice(-MAX_HISTORY_SAVED)
        .map((m) => ({
          id: m.id,
          role: m.role,
          text: m.text,
          time: m.time,
          model: m.model,
        }));
      localStorage.setItem(STORAGE_KEYS.chatHistory, JSON.stringify(cleanHistory));

      // 2. gm5:uiPrefs
      localStorage.setItem(
        STORAGE_KEYS.uiPrefs,
        JSON.stringify({
          tasks,
          completedSteps,
          activity,
          memories,
          agentCode,
          autoSpeak: voice.autoSpeak,
        }),
      );

      // 3. gm5:build
      localStorage.setItem(STORAGE_KEYS.build, JSON.stringify(BUILD_INFO));

      // 4. Ensure no auth tokens exist in localStorage
      localStorage.removeItem("authToken");
    } catch {
      setToast("Browser storage unavailable. Changes may not persist.");
    }
  }, [
    tasks,
    completedSteps,
    activity,
    memories,
    history,
    agentCode,
    voice.autoSpeak,
  ]);

  // Sync gm5:currentModel whenever model changes
  useEffect(() => {
    if (model) {
      try {
        localStorage.setItem(STORAGE_KEYS.currentModel, model);
      } catch {}
    }
  }, [model]);

  useEffect(() => {
    if (page === "assistant")
      messagesEndRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [history, sending, page]);

  useEffect(() => {
    if (!toast) return undefined;
    const timer = setTimeout(() => setToast(""), 2800);
    return () => clearTimeout(timer);
  }, [toast]);

  const checkHealth = useCallback(async (force = false) => {
    setRefreshing(true);
    try {
      const data = await apiRequest("/api/health", { method: "GET" }, 8000);
      if (!mounted.current) return;
      setBackend("LIVE");
      setHealthError("");
      const name =
        typeof data?.primary === "string"
          ? data.primary
          : typeof data?.model === "string"
            ? data.model
            : "";
      if (name) {
        setModel(name);
        try {
          localStorage.setItem(STORAGE_KEYS.currentModel, name);
        } catch {}
      }

      // Check providers snapshot
      try {
        const provData = await apiRequest("/api/ai/providers", { method: "GET" }, 8000);
        if (provData?.providers && Array.isArray(provData.providers)) {
          localStorage.setItem(
            STORAGE_KEYS.providerStatus,
            JSON.stringify({
              providers: provData.providers,
              timestamp: provData.timestamp || new Date().toISOString(),
            }),
          );
        }
      } catch {}

      if (data?.aiConfigured === false) {
        setAiStatus("FAILED");
        setAiReason("GEMINI_API_KEY server par set nahi hai (.env check karein).");
      } else {
        try {
          const ai = await apiRequest(
            `/api/ai/status${force === true ? "?force=1" : ""}`,
            { method: "GET" },
            15000,
          );
          if (!mounted.current) return;
          setAiStatus(ai?.status === "verified" ? "VERIFIED" : "FAILED");
          setAiReason(
            ai?.status === "verified" ? "" : ai?.reason || "AI check failed.",
          );
        } catch (e) {
          if (!mounted.current) return;
          setAiStatus("FAILED");
          setAiReason(`AI status check fail: ${e.message}`);
        }
      }
    } catch (error) {
      if (!mounted.current) return;
      setBackend("OFF");
      setAiStatus("UNKNOWN");
      setAiReason("");
      setHealthError(
        error.message?.includes("timed out")
          ? "Backend request timed out."
          : "Backend health endpoint unavailable.",
      );
    } finally {
      if (mounted.current) setRefreshing(false);
    }
  }, []);

  useEffect(() => {
    checkHealth();
    const timer = setInterval(() => {
      if (document.visibilityState === "visible") checkHealth();
    }, 60000);
    return () => clearInterval(timer);
  }, [checkHealth]);

  function logActivity(message) {
    setActivity((prev) =>
      [{ id: uid(), message, time: nowLabel() }, ...prev].slice(0, 30),
    );
  }

  function navigate(id) {
    setPage(id);
    setMenuOpen(false);
  }

  /* ----- memory ----- */
  function addMemory(text) {
    const value = String(text || "")
      .trim()
      .slice(0, 500);
    if (!value) return false;
    setMemories((prev) =>
      prev.some((m) => m.text.toLowerCase() === value.toLowerCase())
        ? prev
        : [
            { id: uid(), text: value, pinned: false, time: Date.now() },
            ...prev,
          ].slice(0, 200),
    );
    logActivity("Memory saved.");
    return true;
  }
  function submitMemory(event) {
    event.preventDefault();
    if (addMemory(memoryInput)) {
      setMemoryInput("");
      setToast("Memory saved.");
    }
  }
  const togglePin = (id) =>
    setMemories((p) =>
      p.map((m) => (m.id === id ? { ...m, pinned: !m.pinned } : m)),
    );
  const deleteMemory = (id) => setMemories((p) => p.filter((m) => m.id !== id));

  /* ----- chat ----- */
  async function sendChat(event) {
    event?.preventDefault();
    const value = chatInput.trim();
    const sentFiles = att.files;
    if ((!value && sentFiles.length === 0) || sending) return;
    if (backend === "OFF") {
      setChatError(
        "Backend offline hai. Refresh dabakar connection check karein.",
      );
      return;
    }
    voice.stopListening();

    const remember = value.match(
      /^(?:remember|yaad rakho|yaad rakhna)[:,\s]+(.+)$/i,
    );
    if (remember && addMemory(remember[1])) setToast("Yaad kar liya ✓");

    const label = sentFiles.length ? ` 📎 ${sentFiles.length} attachment` : "";
    const userMsg = {
      id: uid(),
      role: "user",
      text: (value || "(attachment)") + label,
    };
    const prior = history;
    setHistory((h) => [...h, userMsg]);
    setChatInput("");
    att.clear();
    setSending(true);
    setChatError("");

    try {
      const reply = await askGrandmaster(
        value || "Please review the attached file(s).",
        prior,
        sentFiles,
        { agent, memories, timeoutMs: CHAT_TIMEOUT_MS },
      );
      if (!mounted.current) return;
      if (reply.model) {
        setModel(reply.model);
        try {
          localStorage.setItem(STORAGE_KEYS.currentModel, reply.model);
        } catch {}
      }
      setHistory((h) => [
        ...h,
        {
          id: uid(),
          role: "assistant",
          text: reply.text,
          model: reply.model,
          agent: agent.name,
        },
      ]);
      if (voice.autoSpeak) voice.speak(reply.text);
    } catch (err) {
      if (mounted.current)
        setChatError(err.message || "Request fail ho gayi. Dobara try karein.");
    } finally {
      if (mounted.current) setSending(false);
    }
  }

  function clearChat() {
    voice.stopSpeaking();
    setHistory([GREETING]);
    setChatError("");
    setToast("New chat started.");
  }

  /* ----- builder & team ----- */
  async function handleBuild() {
    const value = prompt.trim();
    if (!value || building) return;
    if (backend === "OFF") {
      setBuildError("Backend offline hai. Pehle connection verify karein.");
      return;
    }
    setBuilding(true);
    setBuildError("");
    setGenerated("");
    try {
      const coding = AGENTS.find((a) => a.code === "CODING");
      const reply = await askGrandmaster(
        `Help implement this application request:\n${value}\n\nReturn a practical implementation plan and code where appropriate. Clearly distinguish suggested code from files actually created. Do not claim that files were written, tests were run, or deployments succeeded unless tools explicitly confirm those actions.`,
        [],
        [],
        { agent: coding, memories },
      );
      if (!mounted.current) return;
      setGenerated(reply.text);
      logActivity("AI builder generated a response.");
    } catch (error) {
      if (mounted.current)
        setBuildError(error.message || "AI builder request failed.");
    } finally {
      if (mounted.current) setBuilding(false);
    }
  }

  async function runTeamTask(event) {
    event.preventDefault();
    const value = teamTask.trim();
    if (!value || teamRunning) return;
    if (backend === "OFF") {
      setTeamError("Backend offline hai.");
      return;
    }
    setTeamRunning(true);
    setTeamError("");
    setTeamOutput("");
    try {
      const roster = AGENTS.map((a) => `${a.name}: ${a.description}`).join(
        "\n",
      );
      const master = AGENTS.find((a) => a.code === "MASTER");
      const reply = await askGrandmaster(
        `Act as Mastermind. Break this goal into steps and assign each step to the most suitable agent from the roster. Output a numbered plan: step, agent, deliverable, how to verify. Do not claim any step was executed.\n\nROSTER:\n${roster}\n\nGOAL:\n${value}`,
        [],
        [],
        { agent: master, memories },
      );
      if (!mounted.current) return;
      setTeamOutput(reply.text);
      logActivity("Mastermind produced a team plan.");
    } catch (error) {
      if (mounted.current)
        setTeamError(error.message || "Team request failed.");
    } finally {
      if (mounted.current) setTeamRunning(false);
    }
  }

  async function copyText(text, setErr) {
    try {
      await navigator.clipboard.writeText(text);
      setCopied(true);
      setTimeout(() => mounted.current && setCopied(false), 1800);
    } catch {
      setErr(
        "Clipboard access unavailable. Select and copy the text manually.",
      );
    }
  }

  /* ----- tasks & roadmap ----- */
  function addTask(event) {
    event.preventDefault();
    const title = taskInput.trim();
    if (!title) return;
    setTasks((prev) => [{ id: uid(), title, done: false }, ...prev]);
    setTaskInput("");
    logActivity(`Task added: ${title.slice(0, 60)}`);
  }
  const toggleTask = (id) =>
    setTasks((p) => p.map((t) => (t.id === id ? { ...t, done: !t.done } : t)));
  const deleteTask = (id) => setTasks((p) => p.filter((t) => t.id !== id));
  const toggleStep = (n) =>
    setCompletedSteps((p) => {
      const has = p.includes(n);
      logActivity(`Roadmap step ${n} ${has ? "unchecked" : "completed"}.`);
      return has ? p.filter((x) => x !== n) : [...p, n].sort((a, b) => a - b);
    });
  const togglePhase = (letter) =>
    setExpandedPhases((p) =>
      p.includes(letter) ? p.filter((x) => x !== letter) : [...p, letter],
    );

  function downloadData() {
    const payload = {
      exportedAt: new Date().toISOString(),
      tasks,
      completedSteps,
      memories,
      activity,
      chatHistory: history.slice(-MAX_HISTORY_SAVED),
    };
    const blob = new Blob([JSON.stringify(payload, null, 2)], {
      type: "application/json",
    });
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.href = url;
    link.download = `grandmaster-data-${Date.now()}.json`;
    document.body.appendChild(link);
    link.click();
    link.remove();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
    setToast("Project data exported.");
  }

  function resetEverything() {
    if (
      !window.confirm(
        "Saari saved tasks, memory, chat aur progress delete ho jayegi. Continue?",
      )
    )
      return;
    try {
      localStorage.removeItem(STORAGE_KEYS.currentModel);
      localStorage.removeItem(STORAGE_KEYS.providerStatus);
      localStorage.removeItem(STORAGE_KEYS.chatHistory);
      localStorage.removeItem(STORAGE_KEYS.uiPrefs);
      localStorage.removeItem(STORAGE_KEY);
    } catch {}
    setTasks([]);
    setCompletedSteps([]);
    setActivity([]);
    setMemories([]);
    setHistory([GREETING]);
    setToast("All local data cleared.");
  }

  /* -------------------------------- renderers ------------------------------- */

  function renderOverview() {
    const currentStep = Math.min(completedCount + 1, 100);
    const pillType =
      backend === "LIVE" ? "green" : backend === "OFF" ? "red" : "";
    return (
      <>
        <section className="gm-card gm-wake-section" style={{ marginTop: 16 }}>
          <div
            style={{
              display: "flex",
              gap: 12,
              alignItems: "center",
              marginBottom: 14,
              flexWrap: "wrap",
            }}
          >
            <button
              className="gm-btn primary"
              onClick={toggleWake}
              style={{ flex: 1, minWidth: 220, fontSize: 18, padding: 16 }}
            >
              {isListening ? "🎙️ MIC ON — Sun raha hoon" : "🦁 BOLO: MERE SHER"}
            </button>
            <span
              className={`gm-pill ${isListening ? "green" : ""}`}
              style={{ fontSize: 12, whiteSpace: "nowrap" }}
            >
              {isListening ? "MIC ALWAYS ON" : "MIC OFF"}
            </span>
            <button
              className="gm-btn primary"
              onClick={runSystemDoctor}
              disabled={doctorRunning}
              style={{ flex: 1, minWidth: 220, fontSize: 16, padding: 14 }}
            >
              {doctorRunning ? "⏳ System scan chal raha hai..." : "🩺 Mere Sher System Theek Karo"}
            </button>
          </div>
          <div className="gm-grid gm-two" style={{ gap: 16 }}>
            <section className="gm-card">
              <SectionHeader
                title="Hamzad — Yaad-daasht"
                subtitle="Meri kamzori, mera roadmap tarteeb se"
              />
              <div className="gm-muted gm-small" style={{ marginBottom: 10 }}>
                Face, voice, writing style aur roadmap yahan save hote hain.
              </div>
              <div className="gm-list" style={{ marginTop: 8 }}>
                <div className="gm-list-row">
                  <span className="gm-row-icon">👤</span>
                  <div className="gm-row-main">
                    <div className="gm-row-title">Profile</div>
                    <div className="gm-row-sub">
                      {hamzadSaved ? "Save hua hai" : "Abhi koi profile nahi"}
                    </div>
                  </div>
                </div>
                <div className="gm-list-row">
                  <span className="gm-row-icon">⚠️</span>
                  <div className="gm-row-main">
                    <div className="gm-row-title">Kamzori (Weaknesses)</div>
                    <div className="gm-row-sub">
                      {weaknessesInput || "Koi nahi recorded"}
                    </div>
                  </div>
                </div>
                <div className="gm-list-row">
                  <span className="gm-row-icon">🗺️</span>
                  <div className="gm-row-main">
                    <div className="gm-row-title">Roadmap (Tarteeb Lock)</div>
                    <div className="gm-row-sub">
                      {roadmapLocked ? "Tarteeb Locked" : "Open"}
                    </div>
                  </div>
                </div>
              </div>
            </section>
            <section className="gm-card">
              <SectionHeader
                title="Dimagh — Live Logs"
                subtitle="System brain activity"
              />
              <div
                style={{
                  height: 200,
                  overflowY: "auto",
                  border: "1px solid #eee",
                  borderRadius: 8,
                  padding: 10,
                  background: "#fafafa",
                }}
              >
                {dimaghLogs.length === 0 ? (
                  <div className="gm-muted gm-small">Logs yahan aayenge.</div>
                ) : (
                  dimaghLogs.map((l, i) => (
                    <div key={i} className="gm-log-row">
                      [Dimagh] {l}
                    </div>
                  ))
                )}
              </div>
            </section>
          </div>
          {isTriggered && (
            <div
              className="gm-notice success"
              role="status"
              style={{ marginTop: 10, textAlign: "center" }}
            >
              [MERE SHER] Triggered &rarr; [Hamzad] Zinda &rarr; [Dimagh]
              Zinda
            </div>
          )}

          {doctorScan && (
            <section className="gm-card" style={{ marginTop: 16 }}>
              <SectionHeader
                title="System Doctor — Scan Report"
                subtitle="Virus scan aur disk cleanup result"
              />
              <div className="gm-list" style={{ marginTop: 8 }}>
                <div className="gm-list-row">
                  <span className="gm-row-icon">🦠</span>
                  <div className="gm-row-main">
                    <div className="gm-row-title">Threats Found</div>
                    <div className="gm-row-sub">
                      {doctorScan.threats.length} threat(s)
                    </div>
                  </div>
                </div>
                <div className="gm-list-row">
                  <span className="gm-row-icon">🗑️</span>
                  <div className="gm-row-main">
                    <div className="gm-row-title">Junk Files Cleaned</div>
                    <div className="gm-row-sub">
                      {doctorScan.junkFiles.length} file(s)
                    </div>
                  </div>
                </div>
                <div className="gm-list-row">
                  <span className="gm-row-icon">⏱️</span>
                  <div className="gm-row-main">
                    <div className="gm-row-title">Last Scan Status</div>
                    <div className="gm-row-sub">
                      {doctorScan.lastScan?.status || "—"}
                    </div>
                  </div>
                </div>
                <div className="gm-list-row">
                  <span className="gm-row-icon">💾</span>
                  <div className="gm-row-main">
                    <div className="gm-row-title">Freed Space</div>
                    <div className="gm-row-sub">
                      {(doctorScan.lastCleanup?.freedBytes / 1024 / 1024).toFixed(
                        2,
                      )} MB
                    </div>
                  </div>
                </div>
              </div>
              {doctorScan.threats.length > 0 && (
                <div
                  className="gm-notice warning"
                  role="status"
                  style={{ marginTop: 10, textAlign: "center" }}
                >
                  ⚠️ Koi threat mila hai — system check karein
                </div>
              )}
            </section>
          )}
        </section>

        <PageHead
          kicker="Central Command · TAJ Edition · Gen 5"
          title="Welcome to"
          accent="Grandmaster."
          subtitle="AI partner, development command center aur business workspace."
          action={
            <button
              className="gm-btn primary"
              onClick={() => navigate("assistant")}
            >
              ✦ Talk to Grandmaster
            </button>
          }
        />
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
            icon="◉"
            title="Memory"
            value={memories.length}
            note="Facts Grandmaster remembers about you"
          />
          <StatCard
            icon="✦"
            title="AI Backend"
            value={backend === "OFF" ? "OFFLINE" : backend}
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
                  View roadmap
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
                    : `Step ${currentStep}: ${ROADMAP[currentStep - 1]}`}
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
                <StatusPill type={pillType}>{backend}</StatusPill>
              </div>
              <div className="gm-list-row">
                <span className="gm-row-icon">✦</span>
                <div className="gm-row-main">
                  <div className="gm-row-title">AI Provider</div>
                  <div className="gm-row-sub">{model}</div>
                </div>
                <StatusPill
                  type={
                    backend === "OFF"
                      ? "red"
                      : aiStatus === "VERIFIED"
                        ? "green"
                        : aiStatus === "FAILED"
                          ? "gold"
                          : ""
                  }
                >
                  {backend === "OFF"
                    ? "UNAVAILABLE"
                    : aiStatus === "VERIFIED"
                      ? "AI READY"
                      : aiStatus === "FAILED"
                        ? "AI PROBLEM"
                        : "CHECKING"}
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
            {aiStatus === "FAILED" && aiReason && (
              <p className="gm-muted gm-small" style={{ marginTop: 8, color: "var(--red)" }}>
                {aiReason}
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
              ["✦", "AI Assistant", "Chat, voice and attachments", "assistant"],
              ["◉", "Memory", "Teach Grandmaster about you", "memory"],
              ["⬡", "AI Team", "Pick an agent or run a team plan", "agents"],
              [
                "⌘",
                "App Builder",
                "Generate implementation guidance",
                "builder",
              ],
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
    const canSend =
      !sending &&
      backend !== "OFF" &&
      (chatInput.trim() || att.files.length > 0);
    return (
      <>
        <PageHead
          kicker="AI Brain · Conversation Workspace"
          title="Grandmaster"
          accent="AI"
          subtitle="Coding, business, learning, planning aur project assistance."
          action={
            <button className="gm-btn" onClick={clearChat}>
              ＋ New chat
            </button>
          }
        />
        <div className="gm-notice" style={{ marginBottom: 15 }}>
          Chat history aur memory is browser mein save rehti hai. Likhein{" "}
          <strong>“yaad rakho: …”</strong> ya <strong>“remember: …”</strong> aur
          Grandmaster use Memory mein save kar lega. Mic Chrome/Edge mein chalta
          hai.
        </div>

        <section className="gm-chat">
          <div className="gm-output-head">
            <div>
              <strong>GRANDMASTER AI</strong>
              <div className="gm-muted gm-small">
                {model} · {memories.length} memories
              </div>
            </div>
            <div className="gm-head-tools">
              <select
                className="gm-field gm-select"
                value={agentCode}
                onChange={(e) => setAgentCode(e.target.value)}
                aria-label="Active agent"
              >
                {AGENTS.map((a) => (
                  <option key={a.code} value={a.code}>
                    {a.name}
                  </option>
                ))}
              </select>
              <select
                className="gm-field gm-select"
                value={listenLang}
                onChange={(e) => setListenLang(e.target.value)}
                aria-label="Voice input language"
              >
                {LISTEN_LANGS.map(([code, name]) => (
                  <option key={code} value={code}>
                    🎤 {name}
                  </option>
                ))}
              </select>
              {voice.speaking && (
                <button
                  className="gm-btn"
                  type="button"
                  onClick={voice.stopSpeaking}
                >
                  ⏹ Stop voice
                </button>
              )}
              <button
                className="gm-btn"
                type="button"
                disabled={!voice.ttsSupported}
                onClick={() => voice.setAutoSpeak(!voice.autoSpeak)}
                title="Agent ke reply khud bole"
              >
                {voice.autoSpeak ? "🔊 Auto: ON" : "🔇 Auto: OFF"}
              </button>
              <StatusPill
                type={
                  backend === "LIVE" ? "green" : backend === "OFF" ? "red" : ""
                }
              >
                {backend === "LIVE"
                  ? "CONNECTED"
                  : backend === "OFF"
                    ? "UNAVAILABLE"
                    : "CHECKING"}
              </StatusPill>
            </div>
          </div>

          <div className="gm-messages" aria-live="polite">
            {history.map((message) => (
              <div
                className={`gm-message ${message.role === "user" ? "user" : "ai"}`}
                key={message.id || message.text}
              >
                {message.text}
                {message.role !== "user" && (
                  <div className="gm-msg-meta">
                    {message.agent && (
                      <span className="gm-muted gm-small">{message.agent}</span>
                    )}
                    {voice.ttsSupported && (
                      <button
                        className="gm-btn ghost"
                        type="button"
                        style={{ padding: "3px 8px" }}
                        onClick={() => voice.speak(message.text)}
                        aria-label="Read this reply aloud"
                      >
                        🔊
                      </button>
                    )}
                    <button
                      className="gm-btn ghost"
                      type="button"
                      style={{ padding: "3px 8px" }}
                      onClick={() =>
                        addMemory(message.text.slice(0, 300)) &&
                        setToast("Saved to memory.")
                      }
                      aria-label="Save this reply to memory"
                      title="Memory mein save karein"
                    >
                      ◉
                    </button>
                  </div>
                )}
              </div>
            ))}
            {sending && (
              <div className="gm-message ai" role="status">
                Grandmaster is thinking…
              </div>
            )}
            <div ref={messagesEndRef} />
          </div>

          {(chatError || voice.voiceError || att.error) && (
            <div
              className="gm-notice danger"
              style={{ margin: 12 }}
              role="alert"
            >
              {chatError || voice.voiceError || att.error}
            </div>
          )}
          {voice.listening && (
            <div className="gm-notice" style={{ margin: "0 12px 8px" }}>
              🎤 {voice.interim || "Sun raha hoon… boliye"}
            </div>
          )}
          {att.files.length > 0 && (
            <div className="gm-attach-row">
              {att.files.map((f) => (
                <span className="gm-chip" key={f.id}>
                  📎 {f.file.name}{" "}
                  <button
                    type="button"
                    className="gm-x"
                    onClick={() => att.remove(f.id)}
                    aria-label={`Remove ${f.file.name}`}
                  >
                    ×
                  </button>
                </span>
              ))}
            </div>
          )}

          <form className="gm-chat-form" onSubmit={sendChat}>
            <button
              type="button"
              className={`gm-btn ${voice.listening ? "listening" : ""}`}
              onClick={() =>
                voice.listening
                  ? voice.stopListening()
                  : voice.startListening(
                      (text) =>
                        setChatInput((prev) => (prev ? `${prev} ` : "") + text),
                      listenLang,
                    )
              }
              disabled={!voice.sttSupported}
              aria-label={voice.listening ? "Stop voice input" : "Voice input"}
              title={
                voice.sttSupported
                  ? "Bol kar likhein"
                  : "Is browser mein mic support nahi (Chrome/Edge use karein)"
              }
            >
              {voice.listening ? "⏹" : "🎤"}
            </button>
            <AttachButton onPick={att.add} disabled={sending} />
            <textarea
              className="gm-field"
              value={chatInput}
              onChange={(e) => setChatInput(e.target.value)}
              onKeyDown={(e) => {
                if (
                  e.key === "Enter" &&
                  !e.shiftKey &&
                  !e.nativeEvent.isComposing
                ) {
                  e.preventDefault();
                  sendChat();
                }
              }}
              placeholder="Ask anything, @ to mention, / for actions"
              aria-label="Message Grandmaster AI"
            />
            <button
              className="gm-btn primary"
              type="submit"
              disabled={!canSend}
            >
              {sending ? "…" : "➤ Send"}
            </button>
          </form>
        </section>
      </>
    );
  }

  function renderMemory() {
    const sorted = [...memories].sort(
      (a, b) => Number(b.pinned) - Number(a.pinned) || b.time - a.time,
    );
    return (
      <>
        <PageHead
          kicker="Long-term Context"
          title="Grandmaster"
          accent="Memory"
          subtitle="Jo aap yahan save karte hain, har chat mein AI ko bheja jata hai."
          action={
            memories.length > 0 && (
              <button
                className="gm-btn danger"
                onClick={() => {
                  if (window.confirm("Saari memory delete karein?"))
                    setMemories([]);
                }}
              >
                Clear all
              </button>
            )
          }
        />
        <section className="gm-card">
          <SectionHeader
            title="Add a Memory"
            subtitle={`Pinned memories pehle bheji jati hain. Max ${MAX_MEMORY_SENT} per message.`}
          />
          <form
            onSubmit={submitMemory}
            style={{ display: "flex", gap: 10, flexWrap: "wrap" }}
          >
            <input
              className="gm-field"
              style={{ flex: "1 1 260px" }}
              value={memoryInput}
              maxLength={500}
              onChange={(e) => setMemoryInput(e.target.value)}
              placeholder="Example: Main Karachi mein rehta hoon aur React seekh raha hoon."
              aria-label="New memory"
            />
            <button
              className="gm-btn primary"
              type="submit"
              disabled={!memoryInput.trim()}
            >
              + Save memory
            </button>
          </form>
          <div className="gm-divider" />
          {sorted.length === 0 ? (
            <EmptyState>
              No memories yet. Add a preference, a goal or a project detail
              above.
            </EmptyState>
          ) : (
            <div className="gm-list">
              {sorted.map((m) => (
                <div className="gm-list-row" key={m.id}>
                  <span className="gm-row-icon">{m.pinned ? "★" : "◉"}</span>
                  <div className="gm-row-main">
                    <div className="gm-row-title">{m.text}</div>
                    <div className="gm-row-sub">
                      {new Date(m.time).toLocaleString()}
                    </div>
                  </div>
                  <button
                    className="gm-btn ghost"
                    onClick={() => togglePin(m.id)}
                  >
                    {m.pinned ? "Unpin" : "Pin"}
                  </button>
                  <button
                    className="gm-btn ghost danger"
                    onClick={() => deleteMemory(m.id)}
                  >
                    Delete
                  </button>
                </div>
              ))}
            </div>
          )}
        </section>
        <div className="gm-notice" style={{ marginTop: 15 }}>
          Memory sirf is browser mein hai. Passwords, API keys ya financial
          secrets yahan na likhein.
        </div>
      </>
    );
  }

  function renderBuilder() {
    return (
      <>
        <PageHead
          kicker="Software Engineering Workspace"
          title="AI"
          accent="App Builder"
          subtitle="Apna idea describe karein aur implementation guidance hasil karein."
        />
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
            onSubmit={(e) => {
              e.preventDefault();
              handleBuild();
            }}
          >
            <textarea
              className="gm-field gm-textarea"
              value={prompt}
              onChange={(e) => setPrompt(e.target.value)}
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
                disabled={building || !prompt.trim() || backend === "OFF"}
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
                type="button"
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
              <button
                className="gm-btn"
                onClick={() => copyText(generated, setBuildError)}
              >
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
        <PageHead
          kicker="Multi-Agent Architecture"
          title="AI"
          accent="Team"
          subtitle="Ek agent chunein jo chat mein jawab de, ya Mastermind se poori team ka plan banwayein."
        />
        <section className="gm-card" style={{ marginBottom: 16 }}>
          <SectionHeader
            title="Mastermind Team Plan"
            subtitle="Ek goal likhein. Mastermind steps ko sahi agents mein taqseem karta hai."
          />
          <form className="gm-form" onSubmit={runTeamTask}>
            <textarea
              className="gm-field"
              style={{ minHeight: 90 }}
              value={teamTask}
              onChange={(e) => setTeamTask(e.target.value)}
              placeholder="Example: Mere dashboard ko production ke liye ready karna hai."
              aria-label="Team goal"
            />
            <div style={{ display: "flex", justifyContent: "flex-end" }}>
              <button
                className="gm-btn primary"
                type="submit"
                disabled={teamRunning || !teamTask.trim() || backend === "OFF"}
              >
                {teamRunning ? "Planning…" : "⬡ Create team plan"}
              </button>
            </div>
          </form>
          {teamError && (
            <div
              className="gm-notice danger"
              style={{ marginTop: 12 }}
              role="alert"
            >
              {teamError}
            </div>
          )}
          {teamOutput && (
            <div className="gm-output">
              <div className="gm-output-head">
                <strong>TEAM PLAN</strong>
                <span className="gm-muted gm-small">
                  Plan only · nothing was executed
                </span>
              </div>
              <pre>{teamOutput}</pre>
            </div>
          )}
        </section>

        <div className="gm-notice" style={{ marginBottom: 16 }}>
          <strong>Status policy:</strong> Agents are specialist roles given to
          the AI model. Koi agent tab tak “operational” nahi jab tak uska
          execution workflow aur tests verify na hon.
        </div>

        <div className="gm-grid gm-agent-grid">
          {AGENTS.map((a) => {
            const active = a.code === agentCode;
            return (
              <article
                className={`gm-agent ${active ? "active" : ""}`}
                key={a.code}
              >
                <div className="gm-agent-top">
                  <span className="gm-agent-icon">
                    {a.code === "MASTER" ? "✦" : "⬡"}
                  </span>
                  <StatusPill type={active ? "gold" : ""}>
                    {active ? "ACTIVE IN CHAT" : "ROLE"}
                  </StatusPill>
                </div>
                <h3>{a.name}</h3>
                <p>{a.description}</p>
                <div className="gm-divider" />
                <div
                  style={{
                    display: "flex",
                    justifyContent: "space-between",
                    alignItems: "center",
                  }}
                >
                  <span className="gm-muted gm-small">{a.code}</span>
                  <button
                    className="gm-btn"
                    disabled={active}
                    onClick={() => {
                      setAgentCode(a.code);
                      navigate("assistant");
                      setToast(`${a.name} selected.`);
                    }}
                  >
                    {active ? "Selected" : "Use in chat"}
                  </button>
                </div>
              </article>
            );
          })}
        </div>
      </>
    );
  }

  function renderRoadmap() {
    return (
      <>
        <PageHead
          kicker="Engineering Execution Plan"
          title="100-Step"
          accent="Roadmap"
          subtitle="Apne project progress ko track karein. Completion manually record hoti hai."
          action={
            <button className="gm-btn" onClick={() => setCompletedSteps([])}>
              Reset tracking
            </button>
          }
        />
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
            Checking a box updates this browser's tracker; it does not run
            tests.
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
        <PageHead
          kicker="Project Operations"
          title="Projects"
          accent="& Tasks"
          subtitle="Create tasks and track their completion in this browser."
          action={
            <button className="gm-btn" onClick={downloadData}>
              ↓ Export data
            </button>
          }
        />
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
              onChange={(e) => setTaskInput(e.target.value)}
              placeholder="Example: Verify Grandmaster AI chat…"
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
          device or browser. Use export to keep a copy.
        </div>
      </>
    );
  }

  function renderBusiness() {
    const cards = [
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
    ];
    return (
      <>
        <PageHead
          kicker="Business & Productivity"
          title="Business"
          accent="Center"
          subtitle="Manage business planning, content, learning and operational priorities."
        />
        <div className="gm-grid gm-agent-grid">
          {cards.map(([icon, title, description, target, status]) => (
            <article className="gm-agent" key={title}>
              <div className="gm-agent-top">
                <span className="gm-agent-icon">{icon}</span>
                <StatusPill>{status}</StatusPill>
              </div>
              <h3>{title}</h3>
              <p>{description}</p>
              <button className="gm-btn" onClick={() => navigate(target)}>
                Open workspace
              </button>
            </article>
          ))}
        </div>
      </>
    );
  }

  function renderIntegrations() {
    const items = [
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
        <PageHead
          kicker="External Services"
          title="System"
          accent="Integrations"
          subtitle="Review requirements before connecting external accounts or services."
        />
        <div className="gm-notice" style={{ marginBottom: 16 }}>
          No integration is marked CONNECTED unless its connection has been
          verified. This dashboard does not request your passwords or expose API
          keys.
        </div>
        <section className="gm-card">
          <div className="gm-list">
            {items.map(([name, subtitle, description]) => (
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
    const deploymentStatus = {
      label:
        backend === "LIVE"
          ? `VERIFIED LIVE (${BUILD_INFO.commitSha})`
          : backend === "OFF"
            ? "BACKEND UNREACHABLE"
            : "PROBING BACKEND",
      description:
        backend === "LIVE"
          ? `Backend is live and responding. Built from commit ${BUILD_INFO.commitSha} at ${new Date(BUILD_INFO.buildTime).toLocaleString()}.`
          : `Frontend build ${BUILD_INFO.commitSha} is active, but /api/health is currently unreachable.`,
    };

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
        "Never place private API keys in React source code or client env.",
      ],
      [
        "Storage Policy",
        "NO AUTH TOKENS (gm5:*)",
        "Zero tokens or credentials in localStorage. Only non-sensitive UI state (gm5:* keys, chat cap 100, no base64). Auth uses backend httpOnly cookies.",
      ],
      [
        "Social publishing",
        "APPROVAL REQUIRED",
        "Verify account permissions and review external actions.",
      ],
      [
        "AI provider",
        backend === "LIVE" ? "BACKEND REACHABLE" : "UNAVAILABLE",
        aiStatus === "VERIFIED"
          ? `Verified model: ${model}`
          : aiReason || "A health response does not guarantee successful model inference.",
      ],
      [
        "Deployment",
        deploymentStatus.label,
        deploymentStatus.description,
      ],
    ];
    return (
      <>
        <PageHead
          kicker="Security & Operational Controls"
          title="Safety"
          accent="Center"
          subtitle="Honest status reporting, credential safety and external-action boundaries."
          action={
            <button className="gm-btn danger" onClick={resetEverything}>
              Clear local data
            </button>
          }
        />
        <div className="gm-notice danger" style={{ marginBottom: 16 }}>
          <strong>Safety rule:</strong> Do not put private API keys, passwords,
          broker credentials or financial account secrets in frontend code or in
          Memory. Use server-side environment variables and appropriate access
          controls.
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

  const renderers = {
    overview: renderOverview,
    assistant: renderAssistant,
    memory: renderMemory,
    builder: renderBuilder,
    agents: renderAgents,
    desks: () => <AgentDesks apiBase={API_BASE} />,
    roadmap: renderRoadmap,
    projects: renderProjects,
    business: renderBusiness,
    integrations: renderIntegrations,
    security: renderSecurity,
  };

  return (
    <div className="gm" data-app="grandmaster-digital-hub">
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
              TAJ Edition · Gen 5
            </div>
          </div>
        </aside>

        <div className="gm-main">
          <header className="gm-topbar">
            <div className="gm-top-left">
              <button
                className="gm-icon-btn gm-menu-toggle"
                onClick={() => setMenuOpen((v) => !v)}
                aria-label="Toggle navigation"
                aria-expanded={menuOpen}
              >
                ☰
              </button>
              <div>
                <div className="gm-eyebrow">Grandmaster HQ / Workspace</div>
                <div className="gm-page-title">{PAGE_TITLES[page]}</div>
              </div>
            </div>
            <div className="gm-top-right">
              <div
                className={`gm-status ${backend === "OFF" ? "off" : aiStatus === "VERIFIED" ? "live" : aiStatus === "FAILED" ? "warn" : ""}`}
                role="status"
              >
                <span className="gm-dot" />
                <span className="gm-status-label">
                  {backend === "OFF"
                    ? "Backend offline"
                    : aiStatus === "VERIFIED"
                      ? "AI verified"
                      : aiStatus === "FAILED"
                        ? "AI problem"
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
            {(renderers[page] || renderOverview)()}
            <footer className="gm-footer">
              GRANDMASTER DIGITAL HUB · LEARN · BUILD · EARN
              <br />
              UI status is not proof of backend health or deployment.
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

export default function GrandmasterApp() {
  return (
    <ErrorBoundary>
      <App />
    </ErrorBoundary>
  );
}

/* ---------------------------------- styles --------------------------------- */

const css = `
:root{color-scheme:dark;--bg:#080a11;--panel:#10131e;--panel2:#171b29;--border:rgba(255,255,255,.085);--text:#f1f3fa;--muted:#9098ad;--gold:#f5bc4b;--gold2:#ffe09a;--green:#40d6a0;--red:#ff737d;--blue:#85a9ff}
*{box-sizing:border-box}
body{margin:0;background:var(--bg)}
button,input,textarea,select{font:inherit}
button{cursor:pointer}
button:disabled{opacity:.5;cursor:not-allowed}
button:focus-visible,input:focus-visible,textarea:focus-visible,select:focus-visible{outline:2px solid var(--gold);outline-offset:3px}
.gm{min-height:100vh;background:radial-gradient(ellipse at 60% -20%,rgba(245,188,75,.09),transparent 45%),var(--bg);color:var(--text);font:14px/1.5 Inter,system-ui,-apple-system,"Segoe UI",sans-serif}
.gm *{box-sizing:border-box}
.gm button{color:inherit}
.gm-layout{min-height:100vh}
.gm-sidebar{width:248px;position:fixed;inset:0 auto 0 0;z-index:30;background:rgba(12,15,24,.97);border-right:1px solid var(--border);display:flex;flex-direction:column;padding:20px 14px;overflow-y:auto}
.gm-brand{display:flex;align-items:center;gap:12px;padding:4px 7px 24px}
.gm-logo{width:43px;height:43px;border-radius:13px;display:grid;place-items:center;color:#211706;background:linear-gradient(135deg,var(--gold2),var(--gold));font-weight:900;font-size:21px;box-shadow:0 5px 25px #f5bc4b26}
.gm-brand-name{font-size:17px;font-weight:850;letter-spacing:-.5px}
.gm-brand-sub{color:var(--gold);font-size:9px;letter-spacing:2.1px;font-weight:800}
.gm-section-label{padding:12px 10px 8px;color:#727b91;font-size:10px;font-weight:800;letter-spacing:1.5px}
.gm-nav{display:flex;flex-direction:column;gap:5px}
.gm-nav button{display:flex;align-items:center;gap:11px;text-align:left;width:100%;border:1px solid transparent;border-radius:10px;padding:11px 12px;background:transparent;color:#aab0c1;font-size:12.5px;transition:.15s}
.gm-nav button:hover{background:#ffffff08;color:#fff}
.gm-nav button.active{background:#f5bc4b12;color:var(--gold2);border-color:#f5bc4b2c}
.gm-nav-icon{width:19px;text-align:center;font-size:17px}
.gm-sidebar-bottom{margin-top:auto;padding-top:24px}
.gm-safety-mini{border:1px solid #40d6a026;background:#40d6a008;border-radius:12px;padding:12px}
.gm-safety-title{display:flex;align-items:center;gap:7px;color:var(--green);font-weight:800;font-size:11px}
.gm-safety-mini p{color:var(--muted);font-size:10px;margin:7px 0 0;line-height:1.7}
.gm-main{margin-left:248px;min-width:0}
.gm-topbar{height:70px;position:sticky;top:0;z-index:20;background:#0b0d15ed;backdrop-filter:blur(18px);border-bottom:1px solid var(--border);display:flex;align-items:center;justify-content:space-between;padding:0 30px;gap:12px}
.gm-top-left,.gm-top-right{display:flex;align-items:center;gap:12px}
.gm-eyebrow{color:var(--muted);font-size:11px}
.gm-page-title{font-weight:800;font-size:15px}
.gm-status{display:inline-flex;align-items:center;gap:7px;border:1px solid var(--border);background:var(--panel);border-radius:999px;padding:7px 10px;font-size:10px;color:var(--muted)}
.gm-dot{width:7px;height:7px;border-radius:50%;background:#788197}
.gm-status.live{color:var(--green);border-color:#40d6a033}
.gm-status.live .gm-dot{background:var(--green);box-shadow:0 0 9px #40d6a0}
.gm-status.off{color:var(--red);border-color:#ff737d33}
.gm-status.off .gm-dot{background:var(--red)}.gm-status.warn{color:var(--gold);border-color:#f5bc4b44}.gm-status.warn .gm-dot{background:var(--gold);box-shadow:0 0 9px #f5bc4b}
.gm-icon-btn{border:1px solid var(--border);background:var(--panel);border-radius:10px;padding:8px 11px}
.gm-content{max-width:1500px;margin:0 auto;padding:28px 30px 70px}
.gm-welcome{display:flex;align-items:flex-start;justify-content:space-between;gap:20px;margin-bottom:26px}
.gm-kicker{color:var(--gold);font-size:10px;letter-spacing:2px;font-weight:900;text-transform:uppercase}
.gm-h1{font-size:clamp(25px,3vw,36px);letter-spacing:-1.2px;line-height:1.2;margin:7px 0 9px;font-weight:850}
.gm-gradient{background:linear-gradient(100deg,var(--gold2),var(--gold));-webkit-background-clip:text;background-clip:text;color:transparent}
.gm-muted{color:var(--muted)}
.gm-small{font-size:11px}
.gm-btn{display:inline-flex;align-items:center;justify-content:center;gap:8px;padding:10px 14px;border-radius:10px;border:1px solid var(--border);background:var(--panel2);font-weight:700;font-size:12px;transition:.15s}
.gm-btn:hover:not(:disabled){border-color:#f5bc4b66;transform:translateY(-1px)}
.gm-btn.primary{background:linear-gradient(135deg,var(--gold2),var(--gold));color:#211706;border-color:transparent}
.gm .gm-btn.primary{color:#211706}
.gm-btn.ghost{background:transparent}
.gm-btn.danger{color:var(--red)}
.gm-btn.listening{border-color:var(--red);color:var(--red)}
.gm-grid{display:grid;gap:15px}
.gm-stats{grid-template-columns:repeat(4,minmax(0,1fr));margin-bottom:20px}
.gm-card{background:linear-gradient(145deg,#121622,#0e111a);border:1px solid var(--border);border-radius:15px;padding:18px;min-width:0}
.gm-card-title{display:flex;justify-content:space-between;align-items:center;gap:10px;font-size:12px;font-weight:750}
.gm-stat-icon{display:grid;place-items:center;width:35px;height:35px;border-radius:10px;background:#f5bc4b12;color:var(--gold);font-size:17px}
.gm-stat-value{font-size:29px;font-weight:850;letter-spacing:-1px;margin:16px 0 3px}
.gm-stat-note{font-size:10px;color:var(--muted)}
.gm-two{grid-template-columns:minmax(0,1.5fr) minmax(270px,1fr);margin-bottom:20px}
.gm-card-head{display:flex;align-items:center;justify-content:space-between;gap:12px;margin-bottom:16px}
.gm-card-head h2{margin:0;font-size:14px;font-weight:800}
.gm-card-head p{margin:4px 0 0;font-size:10px;color:var(--muted)}
.gm-list{display:flex;flex-direction:column;gap:9px}
.gm-list-row{display:flex;align-items:center;gap:12px;padding:11px;border:1px solid var(--border);border-radius:11px;background:#ffffff03}
.gm-row-icon{width:36px;height:36px;flex:0 0 36px;display:grid;place-items:center;border-radius:10px;background:#f5bc4b12;color:var(--gold);font-size:16px}
.gm-row-main{flex:1;min-width:0}
.gm-row-title{font-size:12px;font-weight:750;overflow-wrap:anywhere}
.gm-row-sub{font-size:10px;color:var(--muted);margin-top:3px}
.gm-pill{display:inline-flex;align-items:center;gap:5px;border-radius:999px;padding:5px 8px;font-size:9px;font-weight:850;letter-spacing:.3px;background:#ffffff08;border:1px solid var(--border);color:var(--muted);white-space:nowrap}
.gm-pill.green{color:var(--green);background:#40d6a00d;border-color:#40d6a02b}
.gm-pill.gold{color:var(--gold2);background:#f5bc4b0d;border-color:#f5bc4b2b}
.gm-pill.red{color:var(--red);background:#ff737d0d;border-color:#ff737d2b}
.gm-progress{height:6px;background:#ffffff0c;border-radius:99px;overflow:hidden}
.gm-progress-fill{height:100%;border-radius:99px;background:linear-gradient(90deg,var(--gold),var(--gold2));transition:width .3s}
.gm-quick-grid{display:grid;grid-template-columns:repeat(3,minmax(0,1fr));gap:10px}
.gm-quick{text-align:left;border:1px solid var(--border);background:#ffffff03;border-radius:12px;padding:14px;min-height:100px}
.gm-quick:hover{border-color:#f5bc4b66;background:#f5bc4b08}
.gm-quick-icon{font-size:21px;color:var(--gold);margin-bottom:8px}
.gm-quick-title{font-weight:800;font-size:12px}
.gm-quick-desc{font-size:10px;color:var(--muted);margin-top:4px}
.gm-field{width:100%;border:1px solid var(--border);border-radius:10px;background:#090c14;color:var(--text);padding:12px;outline:none}
.gm-field:focus{border-color:#f5bc4b88}
.gm-select{width:auto;padding:8px 10px;font-size:11px;max-width:150px}
.gm-textarea{width:100%;min-height:130px;resize:vertical;line-height:1.7}
.gm-form{display:flex;flex-direction:column;gap:12px}
.gm-builder{border:1px solid #f5bc4b26;background:linear-gradient(130deg,#f5bc4b0c,#10131e 55%);border-radius:17px;padding:22px}
.gm-builder textarea{min-height:145px}
.gm-suggestions{display:flex;flex-wrap:wrap;gap:8px;margin-top:12px}
.gm-chip{display:inline-flex;align-items:center;gap:6px;padding:7px 10px;border:1px solid var(--border);border-radius:99px;background:#ffffff04;color:#c4cad8;font-size:10px}
button.gm-chip:hover{color:var(--gold2);border-color:#f5bc4b77}
.gm-x{border:0;background:transparent;color:var(--red);font-size:14px;line-height:1;padding:0 2px}
.gm-output{margin-top:18px;border:1px solid var(--border);border-radius:13px;overflow:hidden}
.gm-output-head{display:flex;align-items:center;justify-content:space-between;gap:10px;background:var(--panel2);padding:11px 14px;border-bottom:1px solid var(--border);flex-wrap:wrap}
.gm-head-tools{display:flex;align-items:center;gap:8px;flex-wrap:wrap;justify-content:flex-end}
.gm-output pre{white-space:pre-wrap;overflow-wrap:anywhere;max-height:500px;overflow:auto;padding:16px;margin:0;font:12px/1.8 ui-monospace,Consolas,monospace;color:#dce1ef}
.gm-chat{display:flex;flex-direction:column;height:min(680px,72vh);min-height:400px;border:1px solid var(--border);border-radius:15px;overflow:hidden;background:#0d1019}
.gm-messages{flex:1;overflow-y:auto;display:flex;flex-direction:column;gap:13px;padding:18px}
.gm-message{max-width:88%;white-space:pre-wrap;overflow-wrap:anywhere;padding:12px 14px;border-radius:13px;font-size:12px;line-height:1.8}
.gm-message.user{align-self:flex-end;background:linear-gradient(135deg,var(--gold2),var(--gold));color:#211706;border-bottom-right-radius:3px}
.gm-message.ai{align-self:flex-start;background:var(--panel2);border:1px solid var(--border);border-bottom-left-radius:3px}
.gm-msg-meta{display:flex;align-items:center;gap:6px;margin-top:6px}
.gm-attach-row{display:flex;flex-wrap:wrap;gap:6px;padding:0 12px 8px}
.gm-chat-form{display:flex;align-items:flex-end;gap:9px;padding:12px;border-top:1px solid var(--border)}
.gm-chat-form textarea{min-height:43px;max-height:130px;resize:vertical}
.gm-empty{padding:28px 15px;text-align:center;color:var(--muted);font-size:12px}
.gm-agent-grid{grid-template-columns:repeat(3,minmax(0,1fr))}
.gm-agent{border:1px solid var(--border);background:var(--panel);border-radius:13px;padding:15px;min-width:0}
.gm-agent.active{border-color:#f5bc4b66;background:#f5bc4b08}
.gm-agent-top{display:flex;align-items:center;justify-content:space-between;gap:8px;margin-bottom:13px}
.gm-agent-icon{width:36px;height:36px;display:grid;place-items:center;background:#f5bc4b12;border-radius:10px;color:var(--gold);font-size:16px}
.gm-agent h3{font-size:12px;margin:0 0 6px}
.gm-agent p{font-size:10px;color:var(--muted);min-height:31px;margin:0 0 12px}
.gm-roadmap-phase{border:1px solid var(--border);border-radius:13px;background:var(--panel);margin-bottom:12px;overflow:hidden}
.gm-phase-head{width:100%;display:flex;align-items:center;gap:12px;text-align:left;padding:15px;border:0;background:transparent}
.gm-phase-letter{display:grid;place-items:center;width:34px;height:34px;border-radius:10px;background:#f5bc4b12;color:var(--gold);font-weight:900}
.gm-phase-main{flex:1}
.gm-phase-main strong{display:block;font-size:12px}
.gm-phase-main span{color:var(--muted);font-size:10px}
.gm-phase-body{padding:0 14px 12px}
.gm-step{display:flex;align-items:center;gap:10px;padding:10px 4px;border-top:1px solid #ffffff08}
.gm-step-num{width:26px;color:#7d879c;font-size:10px;font-weight:800}
.gm-step-title{flex:1;font-size:11px}
.gm-step input{accent-color:var(--gold);width:15px;height:15px}
.gm-task{display:flex;align-items:center;gap:10px;border:1px solid var(--border);border-radius:10px;padding:11px;margin-bottom:8px}
.gm-task input{accent-color:var(--gold)}
.gm-task-text{flex:1;overflow-wrap:anywhere;font-size:12px}
.gm-task.done .gm-task-text{text-decoration:line-through;color:var(--muted)}
.gm-divider{height:1px;background:var(--border);margin:17px 0}
.gm-notice{border:1px solid #f5bc4b2b;background:#f5bc4b08;color:#d5d8e3;border-radius:12px;padding:13px;font-size:11px;line-height:1.8}
.gm-notice strong{color:var(--gold2)}
.gm-notice.danger{border-color:#ff737d35;background:#ff737d08}
.gm-footer{margin-top:45px;padding-top:18px;border-top:1px solid var(--border);color:#727b91;font-size:10px;text-align:center}
.gm-toast{position:fixed;right:20px;bottom:20px;z-index:100;border:1px solid #40d6a044;background:#101c1a;color:var(--green);padding:12px 16px;border-radius:11px;box-shadow:0 10px 35px #0008;font-size:12px}
.gm-menu-toggle{display:none}
@media(max-width:1100px){
  .gm-sidebar{width:220px}.gm-main{margin-left:220px}.gm-content{padding:24px 20px 60px}
  .gm-stats{grid-template-columns:repeat(2,minmax(0,1fr))}.gm-agent-grid{grid-template-columns:repeat(2,minmax(0,1fr))}.gm-two{grid-template-columns:1fr}
}
@media(max-width:760px){
  .gm-sidebar{width:270px;transform:translateX(-102%);transition:transform .22s}
  .gm-sidebar.open{transform:translateX(0);box-shadow:25px 0 60px #0008}
  .gm-main{margin-left:0}.gm-topbar{height:62px;padding:0 14px}.gm-menu-toggle{display:inline-flex}
  .gm-content{padding:23px 14px 50px}.gm-welcome{flex-direction:column}.gm-stats{gap:10px}.gm-card{padding:14px}
  .gm-stat-value{font-size:25px}.gm-quick-grid{grid-template-columns:repeat(2,minmax(0,1fr))}.gm-agent-grid{grid-template-columns:1fr}
  .gm-status{padding:7px}.gm-status-label{display:none}.gm-message{max-width:95%}.gm-head-tools{justify-content:flex-start}
}
@media(max-width:390px){.gm-top-right{gap:6px}.gm-stat-value{font-size:22px}}
@media(prefers-reduced-motion:reduce){*,*::before,*::after{scroll-behavior:auto!important;animation:none!important;transition:none!important}}
`;
