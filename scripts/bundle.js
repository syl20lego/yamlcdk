#!/usr/bin/env node
/**
 * Bundle Zod with the compiled yamlcdk dist to prevent
 * version conflicts when consumer projects have different Zod versions.
 */

import { buildSync } from "esbuild";
import { fileURLToPath } from "url";
import { dirname, join } from "path";
import { renameSync, rmSync, readdirSync } from "fs";

const __dirname = dirname(fileURLToPath(import.meta.url));
const projectRoot = join(__dirname, "..");

// Use ESM format but bundle all non-external dependencies including Zod
buildSync({
  entryPoints: [join(projectRoot, "dist", "cli.js")],
  outfile: join(projectRoot, "dist", "cli.bundled.js"),
  bundle: true,
  platform: "node",
  target: "node20",
  format: "esm",
  external: [
    // Keep ONLY AWS CDK and Commander as external
    // Inline Zod and js-yaml to avoid version conflicts
    "aws-cdk",
    "aws-cdk-lib",
    "commander",
    "constructs",
  ],
});

// Rename to .js
renameSync(
  join(projectRoot, "dist", "cli.bundled.js"),
  join(projectRoot, "dist", "cli.js")
);

// Remove all other dist directories and files to prevent
// ESM module resolution from using them instead of the bundle
const distDir = join(projectRoot, "dist");
const distContents = readdirSync(distDir);
for (const item of distContents) {
  const fullPath = join(distDir, item);
  // Keep only cli.js and type definition files
  if (!item.startsWith("cli") && !item.endsWith(".d.ts")) {
    rmSync(fullPath, { recursive: true });
  }
}

console.log("✓ Bundled Zod into dist/cli.js (includes Zod and js-yaml)");
console.log("✓ Cleaned up extra dist files to prevent module resolution conflicts");
