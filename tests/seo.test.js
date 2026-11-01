import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import { applySeo, SITE_ORIGIN } from "../src/seo.js";

const root = new URL("../", import.meta.url);
const read = (relative) => fs.readFileSync(new URL(relative, root), "utf8");

const CANONICAL_ORIGIN = "https://grandmaster-digital-hub.vercel.app";
const OWNERSHIP_TEXT =
  "© 2026 Grandmaster Academy | Founder - Chunian, Punjab, Pakistan | Contact: businesskids62@gmail.com | Built by Grandmaster Digital Hub";
const DEFAULT_TITLE = "Grandmaster Academy - Personal AI Teacher - Urdu English";
const DEFAULT_DESCRIPTION = "Har student ka apna AI Ustaad - Freelancing seekho free me";
const PUBLIC_SITEMAP_URLS = [
  `${CANONICAL_ORIGIN}/academy`,
  `${CANONICAL_ORIGIN}/academy/login`,
  `${CANONICAL_ORIGIN}/academy/signup`,
  `${CANONICAL_ORIGIN}/privacy`,
  `${CANONICAL_ORIGIN}/terms`,
  `${CANONICAL_ORIGIN}/support`,
];
const REQUIRED_DISALLOW_LINES = [
  "Disallow: /admin",
  "Disallow: /api/",
  "Disallow: /health",
  "Disallow: /academy/profile",
  "Disallow: /academy/progress",
  "Disallow: /academy/courses",
  "Disallow: /academy/lessons",
  "Disallow: /academy/quizzes",
  "Disallow: /academy/forgot",
  "Disallow: /academy/reset",
];

class FakeElement {
  constructor(tag) {
    this.tag = tag;
    this.attributes = {};
  }

  setAttribute(key, value) {
    this.attributes[key] = String(value);
  }

  getAttribute(key) {
    return this.attributes[key];
  }
}

function matches(element, selector) {
  if (element.tag === "link" && selector === 'link[rel="canonical"]') {
    return element.attributes.rel === "canonical";
  }
  if (element.tag === "meta" && selector.startsWith("meta[")) {
    const body = selector.slice(5, -1);
    const [key, quoted] = body.split("=");
    return element.attributes[key] === quoted.slice(1, -1);
  }
  return false;
}

function fakeDocument() {
  return {
    title: "",
    head: {
      children: [],
      appendChild(element) {
        this.children.push(element);
        return element;
      },
      querySelector(selector) {
        return this.children.find((element) => matches(element, selector)) || null;
      },
    },
    createElement(tag) {
      return new FakeElement(tag);
    },
  };
}

test("index.html ships default title, description, canonical and Open Graph tags", () => {
  const html = read("index.html");
  assert.match(html, new RegExp(`<title>${DEFAULT_TITLE}</title>`));
  assert.match(html, new RegExp(`<meta\\s+name="description"\\s+content="${DEFAULT_DESCRIPTION}"`));
  assert.match(
    html,
    new RegExp(`<link rel="canonical" href="${CANONICAL_ORIGIN}/" />`),
  );
  for (const property of ["og:title", "og:description", "og:type", "og:url"]) {
    assert.match(html, new RegExp(`<meta\\s+property="${property}"\\s+content="[^"]+"`));
  }
  assert.match(html, new RegExp(`<meta property="og:url" content="${CANONICAL_ORIGIN}/" />`));
  assert.match(html, /<meta name="robots" content="noindex,nofollow" \/>/);
});

test("the static shell is deny-by-default because / serves the private Hub", () => {
  const html = read("index.html");
  const robots = [...html.matchAll(/<meta\s+name="robots"\s+content="([^"]*)"/g)].map(
    (match) => match[1],
  );
  assert.deepEqual(robots, ["noindex,nofollow"], "exactly one static robots directive is allowed");
  assert.ok(
    !html.includes('content="index,follow"'),
    "the shared shell must never advertise itself as indexable before React mounts",
  );
  // The router sends "/" to the Hub, so the shell default is the Hub default.
  const main = read("src/main.jsx");
  assert.doesNotMatch(main, /const academyPaths = \[[^\]]*["']\/["']/);
  assert.match(read("src/App.jsx"), /description: "Private operations dashboard/);
});

test("robots.txt keeps the root crawlable so the noindex directive can be read", () => {
  const lines = read("public/robots.txt")
    .split(/\r?\n/)
    .map((line) => line.trim());
  assert.ok(lines.includes("Allow: /"));
  assert.ok(
    !lines.includes("Disallow: /"),
    "a blanket Disallow would hide the shell and make its noindex invisible",
  );
});

test("runtime SEO keeps every verified public route indexable and every private route out", () => {
  const previous = globalThis.document;
  try {
    // Public Academy routes pass no robots value and inherit the indexable default.
    for (const path of ["/academy", "/academy/login", "/academy/signup", "/privacy", "/terms", "/support"]) {
      const document = fakeDocument();
      globalThis.document = document;
      applySeo({ title: "Public", description: "Public page.", path });
      assert.equal(
        document.head.querySelector('meta[name="robots"]').attributes.content,
        "index,follow",
        `${path} must stay indexable at runtime`,
      );
      assert.equal(
        document.head.querySelector('link[rel="canonical"]').attributes.href,
        `${SITE_ORIGIN}${path}`,
      );
    }

    // The private Hub shell and the signed-in Academy area opt out explicitly.
    for (const path of ["/", "/health", "/academy/profile", "/academy/progress", "/academy/courses"]) {
      const document = fakeDocument();
      globalThis.document = document;
      applySeo({
        title: "Private",
        description: "Private area.",
        path,
        robots: "noindex,nofollow",
      });
      assert.equal(
        document.head.querySelector('meta[name="robots"]').attributes.content,
        "noindex,nofollow",
        `${path} must stay out of the index`,
      );
    }
  } finally {
    globalThis.document = previous;
  }
});

test("the Academy SEO table marks only verified public routes as indexable", () => {
  const academy = read("src/academy/AcademyApp.jsx");
  const start = academy.indexOf("const PUBLIC_SEO");
  const table = academy.slice(start, academy.indexOf("const PRIVATE_TITLES", start));
  const entry = (name) => {
    const at = table.indexOf(`${name}: {`);
    assert.ok(at >= 0, `PUBLIC_SEO is missing the ${name} entry`);
    return table.slice(at, table.indexOf("},", at));
  };

  for (const name of ["landing", "login", "signup", "privacy", "terms", "support"]) {
    assert.ok(
      !/robots:/.test(entry(name)),
      `${name} must stay on the indexable default instead of a hard-coded opt-out`,
    );
  }
  for (const name of ["forgot", "reset"]) {
    assert.match(entry(name), /robots: "noindex,nofollow"/, `${name} must stay noindex`);
  }
  // Signed-in Academy screens and unknown routes opt out in one shared branch.
  const resolver = academy.slice(academy.indexOf("function seoForRoute"));
  assert.match(resolver, /robots: "noindex,nofollow"/);
  assert.ok(
    resolver.indexOf("if (signedIn)") < resolver.indexOf("return PUBLIC_SEO.landing"),
    "the signed-in branch must opt out before any public route is reused",
  );
});

test("sitemap.xml excludes the private root and only lists Academy-surface routes", () => {
  const xml = read("public/sitemap.xml");
  const urls = [...xml.matchAll(/<loc>([^<]+)<\/loc>/g)].map((match) => match[1]);
  assert.ok(
    !urls.includes(`${CANONICAL_ORIGIN}/`),
    "the private Hub shell at / must never be advertised in the sitemap",
  );
  const academy = read("src/main.jsx");
  const prefixes = [...academy.matchAll(/["'](\/[a-z]+)["']/g)].map((match) => match[1]);
  for (const url of urls) {
    const pathname = url.slice(CANONICAL_ORIGIN.length);
    const first = `/${pathname.split("/")[1]}`;
    assert.ok(
      prefixes.includes(first),
      `${url} is not routed to the public Academy surface (${first})`,
    );
  }
});

test("robots.txt allows public pages and blocks admin and API routes", () => {
  const robots = read("public/robots.txt");
  const lines = robots.split(/\r?\n/).map((line) => line.trim());
  assert.ok(lines.includes("User-agent: *"));
  assert.ok(lines.includes("Allow: /"));
  for (const directive of REQUIRED_DISALLOW_LINES) {
    assert.ok(lines.includes(directive), `robots.txt must keep "${directive}"`);
  }
  assert.ok(lines.includes(`Sitemap: ${CANONICAL_ORIGIN}/sitemap.xml`));
  assert.ok(!/YOUR-DOMAIN\.com/.test(robots));
});

test("sitemap.xml lists only public pages", () => {
  const xml = read("public/sitemap.xml");
  assert.match(xml, /<urlset xmlns="http:\/\/www\.sitemaps\.org\/schemas\/sitemap\/0\.9">/);
  const urls = [...xml.matchAll(/<loc>([^<]+)<\/loc>/g)].map((match) => match[1]);
  assert.deepEqual(urls, PUBLIC_SITEMAP_URLS);
  assert.equal(urls.length, 6);
  for (const url of urls) {
    assert.ok(url.startsWith(`${CANONICAL_ORIGIN}/`), `unexpected sitemap origin: ${url}`);
    assert.doesNotMatch(url, /\/(admin|api|health)(\/|$)/);
    assert.doesNotMatch(url, /\/academy\/(profile|progress|courses|lessons|quizzes|forgot|reset)/);
  }
});

test("the approved canonical origin is used on every SEO surface", () => {
  assert.equal(SITE_ORIGIN, CANONICAL_ORIGIN);
  for (const file of ["index.html", "src/seo.js", "public/robots.txt", "public/sitemap.xml"]) {
    const text = read(file);
    assert.ok(!/YOUR-DOMAIN\.com/.test(text), `${file} still carries the placeholder origin`);
    assert.ok(text.includes(CANONICAL_ORIGIN), `${file} does not reference the canonical origin`);
  }
});

test("ownership footer ships the approved wording from one shared component", () => {
  const component = read("src/OwnershipFooter.jsx");
  assert.ok(component.includes(OWNERSHIP_TEXT), "exact ownership wording must not be rewritten");
  assert.match(component, /className="gm-ownership-footer"/);
  // Responsive wrapping: the line must never force horizontal overflow on Android.
  assert.match(component, /whiteSpace: "normal"/);
  assert.match(component, /overflowWrap: "anywhere"/);
  assert.match(component, /lineHeight: 1\.7/);
  assert.match(component, /fontSize: "12px"/);
});

test("ownership footer renders on hub and academy pages exactly once per view", () => {
  const hub = read("src/App.jsx");
  const legalFooterHost = read("src/academy/components.jsx");
  const legalScreenHost = read("src/academy/AuthScreens.jsx");

  assert.match(hub, /import OwnershipFooter from "\.\/OwnershipFooter\.jsx";/);
  // Hub login view and the signed-in shell footer are mutually exclusive branches.
  assert.equal(hub.split("<OwnershipFooter />").length - 1, 2);
  assert.equal(legalFooterHost.split("<OwnershipFooter />").length - 1, 1);
  assert.equal(legalScreenHost.split("<OwnershipFooter />").length - 1, 1);
  // Academy auth screens reuse LegalFooter, so they must not render the line twice.
  assert.ok(!/OwnershipFooter/.test(read("src/academy/AcademyApp.jsx")));

  // The unused router-coupled footer stays unused rather than being blind-imported.
  assert.ok(!/components\/Footer\.jsx/.test(hub));
  assert.ok(!/components\/Footer\.jsx/.test(read("src/main.jsx")));
});

test("applySeo updates the same tags instead of duplicating them", () => {
  const previous = globalThis.document;
  const document = fakeDocument();
  globalThis.document = document;

  try {
    applySeo({
      title: "Sign In | Grandmaster Academy",
      description: "Sign in to continue your lessons.",
      path: "/academy/login",
    });
    const meta = (selector) => document.head.querySelector(selector).attributes.content;
    const canonical = () =>
      document.head.querySelector('link[rel="canonical"]').attributes.href;

    assert.equal(document.title, "Sign In | Grandmaster Academy");
    assert.equal(meta('meta[name="description"]'), "Sign in to continue your lessons.");
    assert.equal(meta('meta[name="robots"]'), "index,follow");
    assert.equal(meta('meta[property="og:title"]'), "Sign In | Grandmaster Academy");
    assert.equal(meta('meta[property="og:type"]'), "website");
    assert.equal(canonical(), `${SITE_ORIGIN}/academy/login`);

    const tagCount = document.head.children.length;
    applySeo({
      title: "Profile | Grandmaster Academy",
      description: "Private learning area.",
      path: "/academy/profile",
      robots: "noindex,nofollow",
    });

    assert.equal(document.head.children.length, tagCount);
    assert.equal(document.title, "Profile | Grandmaster Academy");
    assert.equal(meta('meta[name="robots"]'), "noindex,nofollow");
    assert.equal(canonical(), `${SITE_ORIGIN}/academy/profile`);
  } finally {
    globalThis.document = previous;
  }
});

test("private app screens opt out of indexing", () => {
  assert.match(read("src/App.jsx"), /robots: "noindex,nofollow"/);
  assert.match(read("src/academy/AcademyApp.jsx"), /robots: "noindex,nofollow"/);
  assert.match(read("src/academy/AcademyApp.jsx"), /useSeo\(seo\)/);
});
