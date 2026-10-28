import { operatorError, sanitizeOperatorMessage } from "./errors.js";
import { validateNavigationUrl } from "./policy.js";

const DEFAULT_TIMEOUT_MS = 15_000;
const MIN_TIMEOUT_MS = 1_000;
const MAX_TIMEOUT_MS = 30_000;
const SENSITIVE_INPUT_NAME =
  /(pass(word|wd)?|otp|one[-_ ]?time|cvv|cvc|card[-_ ]?number|credit[-_ ]?card|iban|account[-_ ]?number|ssn|social[-_ ]?security|seed[-_ ]?phrase|private[-_ ]?key|api[-_ ]?key)/i;
const UNSAFE_CLICK =
  /\b(withdraw|transfer|pay\s*now|make\s*(a\s*)?payment|payment|place\s*(an\s*)?order|buy\s*now|sell\s*now|confirm\s*payment|send\s*money|delete\s*account|close\s*account|unsubscribe|cancel\s*subscription|submit\s*(a\s*)?payment)\b/i;

const SNAPSHOT_SCRIPT = `(() => {
  const selector = 'a,button,input,select,textarea,[role="button"],[role="link"],[role="status"],[contenteditable="true"]';
  const nodes = Array.from(document.querySelectorAll(selector)).slice(0, 60);
  const elements = nodes.map((el, index) => {
    const ref = 'gmop-' + index;
    el.setAttribute('data-gmop-ref', ref);
    const tag = el.tagName.toLowerCase();
    const type = (el.getAttribute('type') || '').toLowerCase();
    const role = (el.getAttribute('role') || '').toLowerCase();
    let name = el.getAttribute('aria-label') || el.getAttribute('name') || el.getAttribute('placeholder') || '';
    if (!name && (tag === 'button' || tag === 'a' || role === 'button' || role === 'link')) {
      name = el.innerText || '';
    }
    name = String(name).replace(/\\s+/g, ' ').trim().slice(0, 80);
    return {
      ref,
      tag,
      type: type || null,
      name,
      sensitive: type === 'password' || type === 'file',
      disabled: Boolean(el.disabled),
    };
  });
  const text = (document.body ? document.body.innerText : '').slice(0, 4000).replace(/\\s+/g, ' ');
  const hasCaptcha = Boolean(document.querySelector('iframe[src*="captcha"], .g-recaptcha, .h-captcha, [data-sitekey]'));
  const signature = [
    location.href,
    document.title,
    text.length,
    elements.length,
    document.querySelectorAll('input,button,a,select,textarea').length,
    location.pathname,
  ].join('|');
  return {
    title: (document.title || '').slice(0, 120),
    elements,
    text,
    hasCaptcha,
    signature,
    href: location.href,
    path: location.pathname,
  };
})()`;

const SIGNATURE_SCRIPT = `(() => {
  const text = document.body ? document.body.innerText : '';
  return [
    location.href,
    document.title,
    text.length,
    document.querySelectorAll('input,button,a,select,textarea').length,
    location.pathname,
  ].join('|');
})()`;

function safeTitle(title) {
  return String(title || "")
    .replace(/[\u0000-\u001f\u007f]/g, " ")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, 120);
}

function hostOf(url) {
  try {
    return new URL(url).hostname.toLowerCase();
  } catch {
    return null;
  }
}

export function resolveBrowserChannel(env = process.env) {
  const raw = String(env?.GRANDMASTER_OPERATOR_BROWSER_CHANNEL || "msedge")
    .trim()
    .toLowerCase();
  if (raw !== "msedge" && raw !== "chrome") {
    throw operatorError(
      503,
      "OPERATOR_BROWSER_CHANNEL_INVALID",
      "GRANDMASTER_OPERATOR_BROWSER_CHANNEL must be msedge or chrome.",
    );
  }
  return raw;
}

export async function loadPlaywright(moduleLoader = () => import("playwright-core")) {
  try {
    const loaded = await moduleLoader();
    const chromium = loaded?.chromium || loaded?.default?.chromium;
    if (!chromium || typeof chromium.launch !== "function") {
      throw new Error("Chromium launcher is unavailable.");
    }
    return chromium;
  } catch {
    throw operatorError(
      503,
      "OPERATOR_PLAYWRIGHT_UNAVAILABLE",
      "playwright-core is not installed. Install it locally; browsers are not downloaded.",
    );
  }
}

function driverFailure(error, fallbackCode = "OPERATOR_DRIVER_FAILED") {
  if (error?.code && error?.status) return error;
  const text = String(error?.message || "");
  if (/target (page, context or browser )?closed|browser has been closed|browser closed|has been closed/i.test(text)) {
    return operatorError(503, "OPERATOR_BROWSER_DISCONNECTED", "The browser disconnected.");
  }
  if (/timeout|timed out|exceeded/i.test(text)) {
    return operatorError(504, "OPERATOR_TIMEOUT", "The browser operation timed out.");
  }
  return operatorError(503, fallbackCode, sanitizeOperatorMessage(text, "The browser operation failed."));
}

export function checkRedirect(finalUrl, env = process.env) {
  const navigation = validateNavigationUrl(finalUrl, env);
  if (!navigation.ok) {
    throw operatorError(
      403,
      "OPERATOR_REDIRECT_BLOCKED",
      "Navigation left the approved host list and was stopped.",
    );
  }
  return navigation;
}

export function detectBlockedPage({ text = "", path = "", hasPassword = false, hasCaptcha = false } = {}) {
  const bodyText = String(text).toLowerCase();
  if (
    hasCaptcha ||
    /(captcha|recaptcha|hcaptcha|i'?m not a robot|i am not a robot|verify you are human|are you a robot)/.test(
      bodyText,
    )
  ) {
    return "OPERATOR_CAPTCHA_DETECTED";
  }
  if (
    hasPassword &&
    /(login|log-in|signin|sign-in|auth|password|sso)/.test(`${String(path).toLowerCase()} ${bodyText.slice(0, 500)}`)
  ) {
    return "OPERATOR_LOGIN_WALL";
  }
  return null;
}

export function assertInputSafe({ type, name } = {}) {
  const inputType = String(type || "").toLowerCase();
  if (inputType === "password" || inputType === "file") {
    throw operatorError(
      403,
      "OPERATOR_SENSITIVE_INPUT_BLOCKED",
      "Password and file inputs are blocked by policy.",
    );
  }
  if (SENSITIVE_INPUT_NAME.test(String(name || ""))) {
    throw operatorError(
      403,
      "OPERATOR_SENSITIVE_INPUT_BLOCKED",
      "Credential, card and secret fields are blocked by policy.",
    );
  }
}

export function assertClickSafe({ text = "", name = "" } = {}) {
  if (UNSAFE_CLICK.test(`${text} ${name}`)) {
    throw operatorError(
      403,
      "OPERATOR_ACTION_PROHIBITED",
      "Financial, destructive and irreversible clicks are blocked by policy.",
    );
  }
}

function sanitizeElements(elements) {
  return elements.slice(0, 40).map((element) => ({
    ref: String(element.ref || ""),
    tag: String(element.tag || "").slice(0, 20),
    type: element.type ? String(element.type).slice(0, 20) : null,
    name: String(element.name || "").slice(0, 80),
    sensitive: Boolean(element.sensitive),
    disabled: Boolean(element.disabled),
  }));
}

/**
 * Real Playwright driver. playwright-core is loaded lazily so the rest of the
 * application (and the mocked test suite) never requires a browser.
 */
export async function createBrowserDriver({ env = process.env, moduleLoader } = {}) {
  const channel = resolveBrowserChannel(env);
  const chromium = await loadPlaywright(moduleLoader);
  const configuredTimeout = Number(env?.GRANDMASTER_OPERATOR_TIMEOUT_MS);
  const timeoutMs = Number.isFinite(configuredTimeout)
    ? Math.min(Math.max(Math.round(configuredTimeout), MIN_TIMEOUT_MS), MAX_TIMEOUT_MS)
    : DEFAULT_TIMEOUT_MS;

  let browser;
  try {
    browser = await chromium.launch({ channel, headless: false });
  } catch {
    throw operatorError(
      503,
      "OPERATOR_BROWSER_UNAVAILABLE",
      `The local ${channel} browser could not be launched.`,
    );
  }
  const browserVersion = String(browser.version?.() || "unknown").slice(0, 80);

  let context = null;
  let page = null;
  let closed = false;

  try {
    context = await browser.newContext({
      acceptDownloads: false,
      permissions: [],
      viewport: { width: 1280, height: 800 },
    });
    page = await context.newPage();
    page.setDefaultTimeout(timeoutMs);
    page.setDefaultNavigationTimeout(timeoutMs);
  } catch {
    await browser.close().catch(() => {});
    throw operatorError(
      503,
      "OPERATOR_BROWSER_UNAVAILABLE",
      "An ephemeral browser context could not be created.",
    );
  }

  function ensureOpen() {
    if (closed || !page) {
      throw operatorError(409, "OPERATOR_BROWSER_DISCONNECTED", "The browser session is closed.");
    }
  }

  async function readSnapshot() {
    const data = await page.evaluate(SNAPSHOT_SCRIPT);
    // A fresh session sits on about:blank until the first navigation.
    const isBlank = !data.href || data.href === "about:blank";
    if (!isBlank) checkRedirect(data.href, env);
    const blocked = detectBlockedPage({
      text: data.text,
      path: data.path,
      hasPassword: data.elements.some((element) => element.type === "password"),
      hasCaptcha: data.hasCaptcha,
    });
    return { data, blocked };
  }

  async function navigate(url) {
    ensureOpen();
    const navigation = validateNavigationUrl(url, env);
    if (!navigation.ok) {
      throw operatorError(navigation.status, navigation.code, navigation.message);
    }
    try {
      await page.goto(navigation.url, { waitUntil: "domcontentloaded" });
      const { data, blocked } = await readSnapshot();
      if (blocked) {
        throw operatorError(
          403,
          blocked,
          blocked === "OPERATOR_CAPTCHA_DETECTED"
            ? "A CAPTCHA was detected. Automation stopped."
            : "A login wall was detected. Automation stopped.",
        );
      }
      return { host: navigation.host, title: safeTitle(data.title) };
    } catch (error) {
      throw driverFailure(error);
    }
  }

  return {
    channel,
    browserVersion,
    timeoutMs,

    async navigate(url) {
      return navigate(url);
    },

    async snapshot() {
      ensureOpen();
      try {
        const { data, blocked } = await readSnapshot();
        const host = data.href === "about:blank" ? null : hostOf(data.href);
        if (blocked) {
          return { blocked, reason: blocked, host, title: safeTitle(data.title), elements: [] };
        }
        return {
          blocked: null,
          host,
          title: safeTitle(data.title),
          elements: sanitizeElements(data.elements),
        };
      } catch (error) {
        throw driverFailure(error);
      }
    },

    async perform(action) {
      ensureOpen();
      try {
        if (action.tool === "navigate") {
          const result = await navigate(action.url);
          return { changeObserved: true, host: result.host };
        }
        if (action.tool === "wait") {
          await page.waitForTimeout(action.ms);
          return { changeObserved: false, host: hostOf(page.url()) };
        }
        if (!/^gmop-\d{1,3}$/.test(String(action.ref || ""))) {
          throw operatorError(
            403,
            "OPERATOR_INVALID_TARGET",
            "Actions must target a snapshot element reference.",
          );
        }

        const locator = page.locator(`[data-gmop-ref="${action.ref}"]`);
        if ((await locator.count()) !== 1) {
          throw operatorError(
            409,
            "OPERATOR_STALE_TARGET",
            "The target element is no longer available. Refresh the snapshot.",
          );
        }
        const meta = await locator.evaluate((element) => ({
          tag: String(element.tagName || "").toLowerCase(),
          type: String(element.getAttribute("type") || "").toLowerCase(),
          name: String(
            element.getAttribute("name") || element.getAttribute("aria-label") || "",
          ).trim(),
          disabled: Boolean(element.disabled),
          text: String(element.innerText || "").trim().slice(0, 200),
        }));

        if (action.tool === "read") {
          const text = String(await locator.innerText().catch(() => ""))
            .replace(/\s+/g, " ")
            .trim()
            .slice(0, 500);
          return { changeObserved: false, observedText: text, host: hostOf(page.url()) };
        }

        if (meta.disabled) {
          throw operatorError(409, "OPERATOR_STALE_TARGET", "The target element is disabled.");
        }
        assertInputSafe(meta);
        if (action.tool === "click") assertClickSafe(meta);

        const before = await page.evaluate(SIGNATURE_SCRIPT);
        if (action.tool === "click") await locator.click();
        else if (action.tool === "fill") await locator.fill(action.value);
        else if (action.tool === "select") await locator.selectOption(action.value);
        else if (action.tool === "press") await locator.press(action.value);
        else {
          throw operatorError(400, "OPERATOR_UNKNOWN_TOOL", "Unsupported action.");
        }

        await page.waitForTimeout(200);
        const { data, blocked } = await readSnapshot();
        if (blocked) {
          return { blocked, host: hostOf(data.href) };
        }
        return {
          changeObserved: before !== data.signature,
          host: hostOf(data.href),
        };
      } catch (error) {
        throw driverFailure(error);
      }
    },

    async close() {
      if (closed) return;
      closed = true;
      try {
        await context?.close();
      } catch {
        // Already closed.
      }
      try {
        await browser.close();
      } catch {
        // Already closed.
      }
    },
  };
}
