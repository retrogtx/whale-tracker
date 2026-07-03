import type { NextConfig } from "next";
import { existsSync, readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

// Load workspace-root env files so the CLI and dashboard share one config.
// .env.local wins over .env (first match set takes precedence).
const here = dirname(fileURLToPath(import.meta.url));
for (const name of [".env.local", ".env"]) {
  const envPath = resolve(here, "../..", name);
  if (!existsSync(envPath)) continue;
  for (const line of readFileSync(envPath, "utf8").split("\n")) {
    const match = line.match(/^\s*([\w.]+)\s*=\s*(.*?)\s*$/);
    if (!match) continue;
    const [, key, rawValue = ""] = match;
    if (key && process.env[key] === undefined) {
      process.env[key] = rawValue.replace(/^["']|["']$/g, "");
    }
  }
}

const config: NextConfig = {
  transpilePackages: ["@whale-tracker/core"],
  webpack: (webpackConfig) => {
    // The core package uses ESM ".js" import specifiers that point at ".ts"
    // source. Teach webpack the same resolution tsc/tsx use.
    webpackConfig.resolve.extensionAlias = {
      ".js": [".ts", ".tsx", ".js"],
      ...webpackConfig.resolve.extensionAlias,
    };
    return webpackConfig;
  },
};

export default config;
