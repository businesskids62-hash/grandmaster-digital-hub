import fs from "node:fs";
import path from "node:path";

export function resolveDataDir(env = process.env) {
  const configured = String(env?.GRANDMASTER_DATA_DIR || "").trim();
  if (configured) return path.resolve(configured);
  if (env?.VERCEL) return path.join("/tmp", "grandmaster-data");
  return path.resolve(process.cwd(), "data");
}

/**
 * Small JSON-file store with serialized writes.
 * Modes:
 *  - durable:   writable local filesystem (default local Node server)
 *  - ephemeral: writable but not durable (Vercel /tmp, per-instance)
 *  - memory:    filesystem unavailable; process memory only
 */
export class JsonStore {
  constructor(name, { env = process.env } = {}) {
    this.name = name;
    this.env = env || {};
    this.dir = resolveDataDir(this.env);
    this.file = path.join(this.dir, `${name}.json`);
    this.mode = "memory";
    this.error = null;
    this.data = { version: 1, items: [] };
    this.queue = Promise.resolve();
    this.load();
  }

  load() {
    try {
      fs.mkdirSync(this.dir, { recursive: true });
      fs.accessSync(this.dir, fs.constants.W_OK);
      this.mode = this.env.VERCEL ? "ephemeral" : "durable";
      if (fs.existsSync(this.file)) {
        const parsed = JSON.parse(fs.readFileSync(this.file, "utf8"));
        if (parsed && Array.isArray(parsed.items)) {
          this.data = { version: 1, items: parsed.items };
        }
      } else {
        this.persist();
      }
    } catch (error) {
      this.mode = "memory";
      this.error = error?.code || "STORAGE_UNAVAILABLE";
    }
  }

  persist() {
    if (this.mode === "memory") return false;
    try {
      const temp = `${this.file}.${process.pid}.tmp`;
      fs.writeFileSync(temp, JSON.stringify(this.data, null, 2), "utf8");
      fs.renameSync(temp, this.file);
      return true;
    } catch (error) {
      this.mode = "memory";
      this.error = error?.code || "STORAGE_WRITE_FAILED";
      return false;
    }
  }

  items() {
    return this.data.items;
  }

  async update(mutator) {
    this.queue = this.queue.then(async () => {
      const draft = {
        version: 1,
        items: this.data.items.map((item) => ({ ...item })),
      };
      const result = await mutator(draft);
      this.data = draft;
      this.persist();
      return result;
    });
    return this.queue;
  }

  status() {
    return {
      mode: this.mode,
      durable: this.mode === "durable",
      ephemeral: this.mode === "ephemeral",
      writable: this.mode !== "memory",
      path: this.mode === "memory" ? null : this.file,
      error: this.error,
    };
  }
}
