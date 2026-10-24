/* ==========================================================================
   HAMZAD — User Memory (Yaad-daasht)
   Saves: face, voice, writing style, roadmap (Tarteeb lock), weaknesses.
   Persists to localStorage so memory survives refreshes.
   ========================================================================== */

const STORAGE_KEY = "hamzad_memory_v1";

const emptyProfile = {
  face: null,            // { capturedAt, note }
  voice: null,           // { capturedAt, note }
  writingStyle: null,    // { capturedAt, note, sample }
  weaknesses: [],        // string[]
  roadmap: [],           // ordered steps [{ id, title, done }]
  roadmapLocked: false,  // Tarteeb lock
  updatedAt: null,
};

function loadProfile() {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return { ...emptyProfile, updatedAt: Date.now() };
    const parsed = JSON.parse(raw);
    return {
      ...emptyProfile,
      ...parsed,
      updatedAt: parsed.updatedAt || Date.now(),
    };
  } catch {
    return { ...emptyProfile, updatedAt: Date.now() };
  }
}

function saveProfile(profile) {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(profile));
  } catch {
    /* storage unavailable */
  }
}

class Hamzad {
  constructor() {
    this.profile = loadProfile();
    this.active = false;
  }

  /* ---- activation ---- */
  activate() {
    this.active = true;
    console.log("[Hamzad] Zinda");
    return this.getSnapshot();
  }

  deactivate() {
    this.active = false;
  }

  isActive() {
    return this.active;
  }

  /* ---- persistence helpers ---- */
  persist() {
    saveProfile(this.profile);
    return this.getSnapshot();
  }

  /* ---- face ---- */
  setFace(note) {
    this.profile.face = { capturedAt: Date.now(), note: String(note || "") };
    return this.persist();
  }

  /* ---- voice ---- */
  setVoice(note) {
    this.profile.voice = { capturedAt: Date.now(), note: String(note || "") };
    return this.persist();
  }

  /* ---- writing style ---- */
  setWritingStyle(note, sample) {
    this.profile.writingStyle = {
      capturedAt: Date.now(),
      note: String(note || ""),
      sample: String(sample || ""),
    };
    return this.persist();
  }

  /* ---- weaknesses ---- */
  setWeaknesses(weaknesses) {
    const list = Array.isArray(weaknesses)
      ? weaknesses.map(String).filter(Boolean)
      : [];
    this.profile.weaknesses = list;
    return this.persist();
  }

  addWeakness(weakness) {
    const w = String(weakness || "").trim();
    if (!w || this.profile.weaknesses.includes(w)) return this.getSnapshot();
    this.profile.weaknesses = [...this.profile.weaknesses, w];
    return this.persist();
  }

  removeWeakness(weakness) {
    this.profile.weaknesses = this.profile.weaknesses.filter(
      (w) => w !== weakness,
    );
    return this.persist();
  }

  /* ---- roadmap with Tarteeb lock ---- */
  setRoadmap(roadmap) {
    const steps = Array.isArray(roadmap)
      ? roadmap.map((step, i) => ({
          id: step.id || `step-${i + 1}`,
          title: String(step.title || ""),
          done: Boolean(step.done),
        }))
      : [];
    this.profile.roadmap = steps;
    return this.persist();
  }

  toggleRoadmapStep(stepId) {
    this.profile.roadmap = this.profile.roadmap.map((step) =>
      step.id === stepId ? { ...step, done: !step.done } : step,
    );
    return this.persist();
  }

  lockTarteeb() {
    this.profile.roadmapLocked = true;
    return this.persist();
  }

  unlockTarteeb() {
    this.profile.roadmapLocked = false;
    return this.persist();
  }

  isTarteebLocked() {
    return Boolean(this.profile.roadmapLocked);
  }

  /* ---- snapshot / getters ---- */
  getSnapshot() {
    return { ...this.profile, active: this.active };
  }

  getProfile() {
    return this.getSnapshot();
  }

  getSummary() {
    const { face, voice, writingStyle, weaknesses, roadmap, roadmapLocked } =
      this.profile;
    return {
      hasFace: Boolean(face),
      hasVoice: Boolean(voice),
      hasWritingStyle: Boolean(writingStyle),
      weaknessCount: weaknesses.length,
      roadmapCount: roadmap.length,
      roadmapCompleted: roadmap.filter((s) => s.done).length,
      roadmapLocked,
    };
  }
}

export const hamzad = new Hamzad();
export default hamzad;
export { Hamzad, emptyProfile, STORAGE_KEY };
