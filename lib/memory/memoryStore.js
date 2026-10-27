import crypto from "node:crypto";
import { JsonStore } from "../storage/jsonStore.js";

export const MEMORY_CATEGORIES = [
  "preference",
  "project",
  "goal",
  "task_summary",
  "instruction",
  "agent_summary",
];

const MAX_MEMORIES = 300;
const MAX_TEXT = 1000;
const SECRET_PATTERN =
  /(api[_-]?key|access[_-]?token|secret[_-]?key|private[_-]?key|password|passwd|bearer\s+[A-Za-z0-9._-]{16,}|sk-[A-Za-z0-9]{16,}|AIza[0-9A-Za-z_-]{20,})/i;

function fail(status, code, message) {
  const error = new Error(message);
  error.status = status;
  error.code = code;
  return error;
}

function normalize(value) {
  return String(value || "")
    .toLowerCase()
    .replace(/\s+/g, " ")
    .trim();
}

function cleanTags(tags) {
  if (!Array.isArray(tags)) return [];
  return tags
    .map((tag) => String(tag || "").trim().slice(0, 30))
    .filter(Boolean)
    .slice(0, 8);
}

export function validateMemoryInput(input = {}) {
  const text = String(input.text || "")
    .replace(/\u0000/g, "")
    .trim();
  if (!text) throw fail(400, "MEMORY_TEXT_REQUIRED", "Memory text is required.");
  if (text.length > MAX_TEXT) {
    throw fail(400, "MEMORY_TOO_LONG", `Memory text must be at most ${MAX_TEXT} characters.`);
  }
  if (SECRET_PATTERN.test(text)) {
    throw fail(
      400,
      "MEMORY_SECRET_REJECTED",
      "Secrets such as API keys, tokens or passwords cannot be stored as memories.",
    );
  }
  const category = String(input.category || "preference").trim();
  if (!MEMORY_CATEGORIES.includes(category)) {
    throw fail(
      400,
      "MEMORY_CATEGORY_INVALID",
      `category must be one of: ${MEMORY_CATEGORIES.join(", ")}.`,
    );
  }
  return {
    text,
    category,
    tags: cleanTags(input.tags),
    source: String(input.source || "user").trim().slice(0, 120) || "user",
  };
}

export class MemoryStore {
  constructor(env = process.env, store = new JsonStore("memory", { env })) {
    this.store = store;
  }

  status() {
    return this.store.status();
  }

  list({ query = "", category = "", limit = 50 } = {}) {
    const safeLimit = Math.min(Math.max(Number(limit) || 50, 1), 200);
    const tokens = normalize(query)
      .split(" ")
      .filter((token) => token.length >= 2);
    let items = this.store.items().filter((item) => !category || item.category === category);

    if (tokens.length) {
      const scored = items.map((item) => {
        const haystack = normalize(`${item.text} ${(item.tags || []).join(" ")} ${item.category}`);
        let score = 0;
        for (const token of tokens) {
          if (haystack.includes(token)) score += 1;
          if (normalize(item.category) === token) score += 2;
        }
        return { item, score };
      });
      items = scored
        .filter((entry) => entry.score > 0)
        .sort((a, b) => b.score - a.score)
        .map((entry) => entry.item);
    }

    return items
      .slice()
      .sort((a, b) => String(b.updatedAt).localeCompare(String(a.updatedAt)))
      .slice(0, safeLimit)
      .map((item) => ({ ...item }));
  }

  get(id) {
    const item = this.store.items().find((entry) => entry.id === id);
    return item ? { ...item } : null;
  }

  findDuplicate(category, text, excludeId = null) {
    const needle = normalize(text);
    const item = this.store.items().find(
      (entry) =>
        entry.id !== excludeId &&
        entry.category === category &&
        normalize(entry.text) === needle,
    );
    return item ? { ...item } : null;
  }

  async create(input = {}) {
    const valid = validateMemoryInput(input);
    const duplicate = this.findDuplicate(valid.category, valid.text);
    if (duplicate) return { item: duplicate, duplicate: true };

    const at = new Date().toISOString();
    const item = {
      id: crypto.randomUUID(),
      ...valid,
      createdAt: at,
      updatedAt: at,
    };
    await this.store.update((draft) => {
      draft.items.unshift(item);
      if (draft.items.length > MAX_MEMORIES) draft.items.length = MAX_MEMORIES;
    });
    return { item: { ...item }, duplicate: false };
  }

  async update(id, input = {}, { authorized = false } = {}) {
    if (!authorized) {
      throw fail(403, "APPROVAL_REQUIRED", "Updating a memory requires control authorization.");
    }
    const existing = this.get(id);
    if (!existing) throw fail(404, "MEMORY_NOT_FOUND", "Memory not found.");

    const merged = validateMemoryInput({
      text: input.text !== undefined ? input.text : existing.text,
      category: input.category !== undefined ? input.category : existing.category,
      tags: input.tags !== undefined ? input.tags : existing.tags,
      source: existing.source,
    });
    const duplicate = this.findDuplicate(merged.category, merged.text, id);
    if (duplicate) throw fail(409, "MEMORY_DUPLICATE", "An identical memory already exists.");

    let updated = null;
    await this.store.update((draft) => {
      const item = draft.items.find((entry) => entry.id === id);
      if (!item) throw fail(404, "MEMORY_NOT_FOUND", "Memory not found.");
      item.text = merged.text;
      item.category = merged.category;
      item.tags = merged.tags;
      item.updatedAt = new Date().toISOString();
      updated = { ...item };
    });
    return updated;
  }

  async remove(id, { authorized = false } = {}) {
    if (!authorized) {
      throw fail(403, "APPROVAL_REQUIRED", "Deleting a memory requires control authorization.");
    }
    const existing = this.get(id);
    if (!existing) throw fail(404, "MEMORY_NOT_FOUND", "Memory not found.");
    await this.store.update((draft) => {
      draft.items = draft.items.filter((entry) => entry.id !== id);
    });
    return { id, deleted: true };
  }

  stats() {
    const items = this.store.items();
    const byCategory = Object.fromEntries(MEMORY_CATEGORIES.map((category) => [category, 0]));
    for (const item of items) {
      if (byCategory[item.category] !== undefined) byCategory[item.category] += 1;
    }
    return { total: items.length, byCategory };
  }
}

export const memoryStore = new MemoryStore(process.env);
