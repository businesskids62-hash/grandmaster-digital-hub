import fs from "node:fs";

const PACKAGE_KEYS = [
  "express",
  "cors",
  "dotenv",
  "react",
  "react-dom",
  "react-router-dom",
  "vite",
  "@vitejs/plugin-react",
  "playwright-core",
];

function readPackageJson() {
  try {
    const file = new URL("../../package.json", import.meta.url);
    return JSON.parse(fs.readFileSync(file, "utf8"));
  } catch {
    // Vercel function bundles may not ship package.json. Stay honest instead
    // of inventing versions.
    return null;
  }
}

export function createStackInfo(env = process.env) {
  const pkg = readPackageJson();
  const deps = { ...(pkg?.dependencies || {}), ...(pkg?.devDependencies || {}) };
  const packages = {};
  for (const key of PACKAGE_KEYS) {
    if (deps[key]) packages[key] = deps[key];
  }
  const serverless = Boolean(env?.VERCEL || env?.AWS_LAMBDA_FUNCTION_NAME);
  return {
    runtime: {
      node: process.version,
      platform: process.platform,
      arch: process.arch,
      serverless,
    },
    framework: serverless
      ? "Vercel Node serverless functions (ESM)"
      : "Express 5 (ESM)",
    app: pkg ? { name: pkg.name, version: pkg.version } : null,
    packages,
    packageMetadata: pkg ? "available" : "unavailable",
  };
}
