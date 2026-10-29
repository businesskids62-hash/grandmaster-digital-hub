import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import { applySeo, SITE_ORIGIN } from "../src/seo.js";

const root = new URL("../", import.meta.url);
const read = (relative) => fs.readFileSync(new URL(relative, root), "utf8");

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
  assert.match(html, /<title>Grandmaster Digital Hub \| Learn, Build, Earn<\/title>/);
  assert.match(html, /<meta\s+name="description"\s+content="[^"]+"/);
  assert.match(html, /<link rel="canonical" href="https:\/\/YOUR-DOMAIN\.com\/" \/>/);
  for (const property of ["og:title", "og:description", "og:type", "og:url"]) {
    assert.match(html, new RegExp(`<meta\\s+property="${property}"\\s+content="[^"]+"`));
  }
  assert.match(html, /<meta name="robots" content="index,follow" \/>/);
});

test("robots.txt allows public pages and blocks admin and API routes", () => {
  const robots = read("public/robots.txt");
  const lines = robots.split(/\r?\n/).map((line) => line.trim());
  assert.ok(lines.includes("User-agent: *"));
  assert.ok(lines.includes("Allow: /"));
  assert.ok(lines.includes("Disallow: /admin"));
  assert.ok(lines.includes("Disallow: /api/"));
  assert.ok(lines.includes("Sitemap: https://YOUR-DOMAIN.com/sitemap.xml"));
});

test("sitemap.xml lists only public pages", () => {
  const xml = read("public/sitemap.xml");
  assert.match(xml, /<urlset xmlns="http:\/\/www\.sitemaps\.org\/schemas\/sitemap\/0\.9">/);
  const urls = [...xml.matchAll(/<loc>([^<]+)<\/loc>/g)].map((match) => match[1]);
  assert.deepEqual(urls, [
    "https://YOUR-DOMAIN.com/academy",
    "https://YOUR-DOMAIN.com/academy/login",
    "https://YOUR-DOMAIN.com/academy/signup",
    "https://YOUR-DOMAIN.com/privacy",
    "https://YOUR-DOMAIN.com/terms",
    "https://YOUR-DOMAIN.com/support",
  ]);
  for (const url of urls) {
    assert.doesNotMatch(url, /\/(admin|api|health)(\/|$)/);
    assert.doesNotMatch(url, /\/academy\/(profile|progress|courses|lessons|quizzes|forgot|reset)/);
  }
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
