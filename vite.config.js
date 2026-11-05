import { defineConfig, loadEnv } from "vite";
import react from "@vitejs/plugin-react";
import { execSync } from "node:child_process";

const DEFAULT_API_TARGET = "http://127.0.0.1:8000";
const DEV_PORT = 5173;

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

export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, process.cwd(), "");
  // 127.0.0.1 avoids the Windows localhost -> ::1 resolution mismatch.
  const apiTarget = process.env.VITE_API_TARGET || env.VITE_API_TARGET || DEFAULT_API_TARGET;
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
    build: {
      target: "es2022",
      chunkSizeWarningLimit: 600,
      rollupOptions: {
        output: {
          manualChunks(id) {
            if (id.includes("node_modules/chart.js") || id.includes("node_modules/react-chartjs-2")) {
              return "chartjs-vendor";
            }
            if (id.includes("node_modules/framer-motion")) {
              return "motion-vendor";
            }
            if (id.includes("node_modules/lucide-react")) {
              return "lucide-vendor";
            }
            if (id.includes("node_modules/qrcode")) {
              return "qrcode-vendor";
            }
            if (id.includes("node_modules/react") || id.includes("node_modules/react-dom") || id.includes("node_modules/react-router-dom")) {
              return "react-vendor";
            }
          },
        },
      },
    },
    server: {
      port: DEV_PORT,
      strictPort: false,
      proxy: {
        "/api": {
          target: apiTarget,
          changeOrigin: true,
        },
      },
      watch: {
        // SQLite writes would otherwise trigger a full page reload mid-request.
        ignored: ["**/data/**", "**/*.db", "**/*.db-wal", "**/*.db-shm"],
      },
    },
  };
});
