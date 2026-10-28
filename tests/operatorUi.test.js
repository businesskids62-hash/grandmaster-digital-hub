import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";

const root = process.cwd();
const ui = fs.readFileSync(path.join(root, "src/pages/BrowserOperator.jsx"), "utf8");
const app = fs.readFileSync(path.join(root, "src/App.jsx"), "utf8");

test("credentials stay in component memory and use separate authorities", () => {
  assert.ok(ui.includes("export default function BrowserOperator"));
  assert.doesNotMatch(ui, /\b(localStorage|sessionStorage)\s*[.[(]/);
  assert.ok(ui.includes('type="password"'));
  assert.ok(ui.includes('autoComplete="off"'));
  assert.ok(ui.includes("X-Grandmaster-Operator-Token"));
  assert.ok(ui.includes("X-Grandmaster-Token"));
});

test("the operator is NOT CONNECTED until server-side verification passes", () => {
  assert.ok(ui.includes("NOT CONNECTED"));
  assert.ok(ui.includes('integrationStatus === "connected"'));
  assert.ok(ui.includes("realConnectorVerified"));
  assert.match(ui, /const canStart =[\s\S]{0,200}connected/);
  assert.ok(ui.includes("disabled={!canStart}"));
  assert.ok(ui.includes("OPERATOR_SERVERLESS_UNSUPPORTED"));
  assert.ok(ui.includes("GRANDMASTER_OPERATOR_USERS"));
  assert.ok(ui.includes("GRANDMASTER_OPERATOR_ALLOWED_HOSTS"));
  assert.ok(ui.includes("test:operator:real"));
});

test("plans freeze a hash and require a separate typed approval", () => {
  assert.ok(ui.includes("planHash"));
  assert.ok(ui.includes('confirmation !== "APPROVE"'));
  assert.ok(ui.includes("controlToken"));
  assert.ok(ui.includes("/operator/runs"));
  assert.ok(ui.includes("/approve"));
  assert.ok(ui.includes("/execute"));
  assert.ok(ui.includes("MAX_ACTIONS"));
  assert.ok(ui.includes("gmop-"));
  assert.match(ui, /Frozen plan hash/);
});

test("session, snapshot and run states are explicit", () => {
  assert.ok(ui.includes("/operator/sessions"));
  assert.ok(ui.includes("/snapshot"));
  for (const status of [
    "AWAITING_APPROVAL",
    "APPROVED",
    "RUNNING",
    "COMPLETED",
    "FAILED",
    "BLOCKED",
  ]) {
    assert.ok(ui.includes(status), `missing run status ${status}`);
  }
  assert.ok(ui.includes("Current tab"));
  assert.ok(ui.includes("Manual fallback"));
  assert.ok(ui.includes("Roman Urdu"));
  assert.ok(ui.includes("CAPTCHA"));
});

test("no prohibited browser capability is exposed", () => {
  assert.doesNotMatch(ui, /type="file"/);
  assert.doesNotMatch(ui, /dangerouslySetInnerHTML/);
  assert.doesNotMatch(ui, /\beval\s*\(/);
  assert.doesNotMatch(ui, /javascript:/i);
  assert.doesNotMatch(ui, /execute_script|solve_captcha|desktop_control/);
  assert.doesNotMatch(ui, /\/api\/chat/);
});

test("navigation exposes the operator page", () => {
  assert.ok(app.includes('import BrowserOperator from "./pages/BrowserOperator.jsx"'));
  assert.ok(app.includes('{ id: "operator"'));
  assert.ok(app.includes("operator: () => <BrowserOperator apiBase={API_BASE} />"));
});

test("the API helper is same-origin and disables caching", () => {
  assert.ok(ui.includes("`${apiBase}/api/v1${path}`"));
  assert.ok(ui.includes('cache: "no-store"'));
  assert.ok(ui.includes('headers["Content-Type"] = "application/json"'));
});
