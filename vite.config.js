import { defineConfig, loadEnv } from "vite";
import react from "@vitejs/plugin-react";
import fs from "node:fs";
import path from "node:path";
import { execSync } from "node:child_process";

function getCommitSha() {
  if (process.env.VERCEL_GIT_COMMIT_SHA) {
    return process.env.VERCEL_GIT_COMMIT_SHA.slice(0, 7);
  }
  try {
    return execSync("git rev-parse --short HEAD", { timeout: 2000, stdio: ["ignore", "pipe", "ignore"] }).toString().trim();
  } catch {
    return "312144a";
  }
}

function getServerPort() {
  try {
    const serverEnvPath = path.resolve(process.cwd(), "server/.env");
    if (fs.existsSync(serverEnvPath)) {
      const content = fs.readFileSync(serverEnvPath, "utf-8");
      const match = content.match(/^PORT\s*=\s*(\d+)/m);
      if (match && match[1]) return Number(match[1]);
    }
  } catch {}
  return Number(process.env.PORT) || 5000;
}

export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, process.cwd(), "");
  const serverPort = getServerPort();
  const commitSha = getCommitSha();
  const buildTime = new Date().toISOString();

  return {
    plugins: [react()],
    define: {
      __BUILD_INFO__: JSON.stringify({
        commitSha,
        buildTime,
      }),
    },
    server: {
      proxy: {
        "/api": {
          target: env.VITE_API_URL || `http://localhost:${serverPort}`,
          changeOrigin: true,
        },
      },
    },
  };
});
