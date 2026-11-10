import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { defineConfig } from "vite";

export default defineConfig({
  publicDir: "public",
  server: { host: "127.0.0.1", port: 5194, strictPort: true },
  plugins: [{
    name: "match-three-body",
    transformIndexHtml(html) {
      return html.replace("<!--app-->", readFileSync(new URL("./src/template.html", import.meta.url), "utf8"));
    },
  }],
  build: {
    outDir: "dist/web",
    emptyOutDir: true,
    target: "es2022",
    minify: process.env.MINI_APP_DEBUG !== "1",
    sourcemap: process.env.MINI_APP_DEBUG === "1" ? "inline" : false,
    cssCodeSplit: false,
    lib: {
      entry: fileURLToPath(new URL("./src/main.ts", import.meta.url)),
      name: "MatchThree",
      formats: ["iife"],
      fileName: () => "app.js",
      cssFileName: "app",
    },
  },
});
