import type { MiniAppManifest } from "@discourse-mini-app/sdk/pack";
import { pack } from "@discourse-mini-app/sdk/pack";
import { copyFile, readFile } from "node:fs/promises";
import appConfig from "../app.config.json";

const manifest = JSON.parse(await readFile("manifest.json", "utf8")) as MiniAppManifest;
manifest.id = process.env.MINI_APP_ID || manifest.id;
manifest.version = process.env.MINI_APP_VERSION || manifest.version;
// Frontend and packaging share the same switch. An old API environment variable cannot enable ranking.
if (appConfig.leaderboard.enabled) {
  const apiOrigin = process.env.MINI_APP_API_ORIGIN;
  if (!apiOrigin) throw new Error("Leaderboard is enabled: set MINI_APP_API_ORIGIN or disable leaderboard.enabled in app.config.json");
  const origin = new URL(apiOrigin);
  if (origin.protocol !== "https:" || origin.port || origin.username || origin.password || origin.origin !== apiOrigin) {
    throw new Error("MINI_APP_API_ORIGIN must be an HTTPS origin on port 443 without a trailing slash/path");
  }
  manifest.permissions = [...new Set([...(manifest.permissions ?? []), "user.read", "network.request"])] as MiniAppManifest["permissions"];
  manifest.endpoints = {
    ...manifest.endpoints,
    leaderboard: { url: `${origin.origin}/v1/leaderboard`, method: "GET", auth: "platform" },
    startRun: { url: `${origin.origin}/v1/runs`, method: "POST", auth: "platform" },
    submitResult: { url: `${origin.origin}/v1/results`, method: "POST", auth: "platform" },
  };
}
await copyFile("src/template.html", "dist/web/index.html");
await copyFile("src/strings.json", "dist/web/strings.json");
const files: Record<string, Buffer> = {};
for (const name of ["index.html", "app.js", "app.css", "strings.json"]) files[name] = await readFile(`dist/web/${name}`);
const result = await pack({ manifest, files, outputDirectory: "dist/package" });
console.log(`Created ${result.file} (${result.size} bytes), app ${manifest.id}, version ${manifest.version}`);
