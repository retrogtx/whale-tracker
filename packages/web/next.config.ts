import type { NextConfig } from "next";
import { existsSync, readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

// Load the workspace-root .env so the CLI and dashboard share one config file.
const here = dirname(fileURLToPath(import.meta.url));
const rootEnv = resolve(here, "../../.env");
if (existsSync(rootEnv)) {
  for (const line of readFileSync(rootEnv, "utf8").split("\n")) {
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
