import { useEffect } from "react";

/**
 * Replace this placeholder with the deployed origin before submitting the
 * sitemap and requesting indexing.
 */
export const SITE_ORIGIN = "https://YOUR-DOMAIN.com";

function absoluteUrl(pathname) {
  const clean = String(pathname || "/").split("?")[0].split("#")[0];
  const withSlash = clean.startsWith("/") ? clean : `/${clean}`;
  return `${SITE_ORIGIN}${withSlash === "/" ? "/" : withSlash.replace(/\/+$/, "")}`;
}

function metaTag(attribute, key) {
  const selector = `meta[${attribute}="${key}"]`;
  let tag = document.head.querySelector(selector);
  if (!tag) {
    tag = document.createElement("meta");
    tag.setAttribute(attribute, key);
    document.head.appendChild(tag);
  }
  return tag;
}

export function applySeo({
  title,
  description,
  path = "/",
  type = "website",
  robots = "index,follow",
} = {}) {
  if (typeof document === "undefined") return;

  if (title) document.title = title;
  if (description) metaTag("name", "description").setAttribute("content", description);
  metaTag("name", "robots").setAttribute("content", robots);

  metaTag("property", "og:title").setAttribute("content", title || document.title);
  if (description) {
    metaTag("property", "og:description").setAttribute("content", description);
  }
  metaTag("property", "og:type").setAttribute("content", type);
  metaTag("property", "og:url").setAttribute("content", absoluteUrl(path));

  let canonical = document.head.querySelector('link[rel="canonical"]');
  if (!canonical) {
    canonical = document.createElement("link");
    canonical.setAttribute("rel", "canonical");
    document.head.appendChild(canonical);
  }
  canonical.setAttribute("href", absoluteUrl(path));
}

export function useSeo({ title, description, path, type, robots } = {}) {
  useEffect(() => {
    applySeo({ title, description, path, type, robots });
  }, [title, description, path, type, robots]);
}
