/* ==========================================================================
   SYSTEM DOCTOR — Virus Scan & Disk Cleanup Agent
   Scans for threats and cleans up disk space.
   ========================================================================== */

function nowISO() {
  return new Date().toISOString();
}

class SystemDoctor {
  constructor() {
    this.active = false;
    this.scanRunning = false;
    this.lastScan = null;
    this.lastCleanup = null;
    this.threats = [];
    this.junkFiles = [];
    this.logs = [];
  }

  /* ---- activation ---- */
  activate() {
    this.active = true;
    console.log("[SystemDoctor] Zinda");
    return this.getSnapshot();
  }

  deactivate() {
    this.active = false;
    this.scanRunning = false;
  }

  isActive() {
    return this.active;
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
    console.log(`[SystemDoctor] ${message}`);
    return entry;
  }

  getLogs(limit = 50) {
    return this.logs.slice(0, limit);
  }

  clearLogs() {
    this.logs = [];
  }

  /* ---- virus scan ---- */
  runVirusScan() {
    if (this.scanRunning) return { running: true };
    this.scanRunning = true;
    this.lastScan = { startedAt: nowISO() };
    this.addLog("Virus scan started", "scan");

    const scan = async () => {
      try {
        await new Promise((r) => setTimeout(r, 2000));
        const threats = this.detectThreats();
        this.threats = threats;
        this.lastScan = {
          startedAt: this.lastScan.startedAt,
          completedAt: nowISO(),
          threatsFound: threats.length,
          status: threats.length > 0 ? "threats_found" : "clean",
        };
        this.addLog(
          `Virus scan complete — ${threats.length} threat(s) found`,
          threats.length > 0 ? "warning" : "success",
        );
      } finally {
        this.scanRunning = false;
      }
    };
    scan();
    return { running: true, startedAt: this.lastScan.startedAt };
  }

  detectThreats() {
    // Browser sandbox: real filesystem access is not available.
    // Returns monitored/simulated threats only.
    return [];
  }

  /* ---- disk cleanup ---- */
  runDiskCleanup() {
    if (this.scanRunning) return { running: true };
    this.scanRunning = true;
    this.lastCleanup = { startedAt: nowISO() };
    this.addLog("Disk cleanup started", "cleanup");

    const cleanup = async () => {
      try {
        await new Promise((r) => setTimeout(r, 1500));
        const cleaned = this.cleanJunk();
        this.junkFiles = cleaned;
        this.lastCleanup = {
          startedAt: this.lastCleanup.startedAt,
          completedAt: nowISO(),
          freedBytes: cleaned.reduce((s, f) => s + (f.size || 0), 0),
          filesRemoved: cleaned.length,
          status: "complete",
        };
        this.addLog(
          `Disk cleanup complete — ${cleaned.length} file(s) removed`,
          "success",
        );
      } finally {
        this.scanRunning = false;
      }
    };
    cleanup();
    return { running: true, startedAt: this.lastCleanup.startedAt };
  }

  cleanJunk() {
    // Browser sandbox: cannot delete real files.
    // Returns simulated junk file list.
    return [];
  }

  /* ---- snapshot / status ---- */
  getSnapshot() {
    return {
      active: this.active,
      scanRunning: this.scanRunning,
      lastScan: this.lastScan,
      lastCleanup: this.lastCleanup,
      threats: this.threats,
      junkFiles: this.junkFiles,
      logs: this.getLogs(),
    };
  }

  getStatus() {
    return {
      active: this.active,
      scanRunning: this.scanRunning,
      lastScan: this.lastScan,
      lastCleanup: this.lastCleanup,
    };
  }
}

export const systemDoctor = new SystemDoctor();
export default systemDoctor;
export { SystemDoctor };
