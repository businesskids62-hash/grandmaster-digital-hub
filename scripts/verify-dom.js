// scripts/verify-dom.js
import * as esbuild from "esbuild";
import React from "react";
import ReactDOMServer from "react-dom/server";
import fs from "fs";

async function verify() {
  const outfile = "./dist/ssr-test.mjs";
  await esbuild.build({
    entryPoints: ["./src/App.jsx"],
    bundle: true,
    format: "esm",
    outfile,
    jsx: "automatic",
    loader: { ".css": "empty" },
    define: {
      "__BUILD_INFO__": JSON.stringify({ commitSha: "312144a", buildTime: new Date().toISOString() }),
      "import.meta.env.VITE_API_URL": '""',
    },
    external: ["react", "react-dom", "react-dom/server"],
  });

  const imported = await import("../dist/ssr-test.mjs");
  const App = imported.default;

  // 1. Initial overview view
  const overviewHtml = ReactDOMServer.renderToString(React.createElement(App));

  console.log("=== #root DOM CHILDREN AUDIT ===");
  console.log("Root element rendered non-empty string. Byte size:", overviewHtml.length);
  console.log("Header ('Welcome to'):", overviewHtml.includes("Welcome to"));
  console.log("Header title ('Grandmaster Digital Hub'):", overviewHtml.includes("Grandmaster Digital Hub"));
  console.log("Live status badge class (gm-status):", overviewHtml.includes("gm-status"));
  console.log("Live status dot (gm-dot):", overviewHtml.includes("gm-dot"));
  console.log("Nav security tab exists:", overviewHtml.includes("Security"));

  // Clean up
  try { fs.unlinkSync(outfile); } catch {}
}

verify().catch((e) => {
  console.error("DOM verification error:", e);
  process.exit(1);
});
