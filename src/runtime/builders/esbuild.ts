import fs from "node:fs";
import path from "node:path";
import { spawnSync } from "node:child_process";
import type { BuildProvider, EsbuildBuildConfig } from "./contracts.js";
import { ensureDir, resolveOutRoot, resolveSourcePath, splitHandler } from "./shared.js";

const ESBUILD_SOURCE_EXTENSIONS = [
  ".ts",
  ".tsx",
  ".mts",
  ".cts",
  ".js",
  ".mjs",
  ".cjs",
] as const;

function resolveEsbuildBin(cwd: string): string {
  const binDir = path.resolve(cwd, "node_modules", ".bin");
  const candidates =
    process.platform === "win32"
      ? ["esbuild.cmd", "esbuild.exe", "esbuild"]
      : ["esbuild"];

  for (const candidate of candidates) {
    const candidatePath = path.join(binDir, candidate);
    if (fs.existsSync(candidatePath)) {
      return candidatePath;
    }
  }

  throw new Error(
    'build.mode=esbuild requires "esbuild" to be installed in the customer project. ' +
      'Install it with "npm install -D esbuild" (or yarn/pnpm equivalent).',
  );
}

function runtimeToEsbuildTarget(runtime: string | undefined): string {
  switch (runtime) {
    case "nodejs24.x":
      return "node24";
    case "nodejs22.x":
      return "node22";
    case "nodejs20.x":
    default:
      return "node20";
  }
}

function pushOptionalBooleanFlag(
  args: string[],
  flag: string,
  value: boolean | undefined,
): void {
  if (value === undefined) return;
  args.push(value ? flag : `${flag}=false`);
}

function buildWithEsbuild(
  functionName: string,
  sourceHandler: string,
  runtime: string | undefined,
  esbuildConfig: EsbuildBuildConfig | undefined,
  cwd: string,
): {
  assetPath: string;
  handler: string;
} {
  const { modulePath: sourceModulePath, exportName: sourceExport } =
    splitHandler(sourceHandler);
  const entryPoint = resolveSourcePath(sourceModulePath, cwd, ESBUILD_SOURCE_EXTENSIONS);
  const outRoot = resolveOutRoot(cwd, functionName);
  ensureDir(outRoot);
  const outFile = path.join(outRoot, "index.js");

  const args: string[] = [entryPoint, `--outfile=${outFile}`];
  const bundle = esbuildConfig?.bundle ?? true;
  args.push(bundle ? "--bundle" : "--bundle=false");
  args.push(`--platform=${esbuildConfig?.platform ?? "node"}`);
  args.push(`--format=${esbuildConfig?.format ?? "cjs"}`);

  const target = esbuildConfig?.target ?? runtimeToEsbuildTarget(runtime);
  args.push(`--target=${Array.isArray(target) ? target.join(",") : target}`);

  pushOptionalBooleanFlag(args, "--minify", esbuildConfig?.minify);
  pushOptionalBooleanFlag(args, "--minify-whitespace", esbuildConfig?.minifyWhitespace);
  pushOptionalBooleanFlag(args, "--minify-identifiers", esbuildConfig?.minifyIdentifiers);
  pushOptionalBooleanFlag(args, "--minify-syntax", esbuildConfig?.minifySyntax);
  pushOptionalBooleanFlag(args, "--keep-names", esbuildConfig?.keepNames);
  pushOptionalBooleanFlag(args, "--ignore-annotations", esbuildConfig?.ignoreAnnotations);

  const sourcemap = esbuildConfig?.sourcemap;
  if (sourcemap !== undefined) {
    if (sourcemap === true) {
      args.push("--sourcemap");
    } else if (sourcemap === false) {
      args.push("--sourcemap=false");
    } else {
      args.push(`--sourcemap=${sourcemap}`);
    }
  }

  if (esbuildConfig?.treeShaking !== undefined) {
    args.push(`--tree-shaking=${esbuildConfig.treeShaking ? "true" : "false"}`);
  }

  for (const value of esbuildConfig?.external ?? []) {
    args.push(`--external:${value}`);
  }
  for (const value of esbuildConfig?.inject ?? []) {
    args.push(`--inject:${value}`);
  }
  for (const value of esbuildConfig?.pure ?? []) {
    args.push(`--pure:${value}`);
  }

  for (const [key, value] of Object.entries(esbuildConfig?.define ?? {})) {
    args.push(`--define:${key}=${value}`);
  }
  for (const [key, value] of Object.entries(esbuildConfig?.loader ?? {})) {
    args.push(`--loader:${key}=${value}`);
  }
  for (const [key, value] of Object.entries(esbuildConfig?.banner ?? {})) {
    args.push(`--banner:${key}=${value}`);
  }
  for (const [key, value] of Object.entries(esbuildConfig?.footer ?? {})) {
    args.push(`--footer:${key}=${value}`);
  }

  if (esbuildConfig?.tsconfig) {
    args.push(`--tsconfig=${path.resolve(cwd, esbuildConfig.tsconfig)}`);
  }
  if (esbuildConfig?.charset) {
    args.push(`--charset=${esbuildConfig.charset}`);
  }
  if (esbuildConfig?.legalComments) {
    args.push(`--legal-comments=${esbuildConfig.legalComments}`);
  }

  const esbuildBin = resolveEsbuildBin(cwd);
  const result = spawnSync(esbuildBin, args, {
    cwd,
    encoding: "utf8",
  });
  if (result.status !== 0) {
    throw new Error(
      `esbuild build failed for function "${functionName}".\n` +
        `Command: ${esbuildBin} ${args.join(" ")}\n` +
        `${result.stdout ?? ""}\n${result.stderr ?? ""}`,
    );
  }
  if (!fs.existsSync(outFile)) {
    throw new Error(
      `esbuild build did not produce expected runtime file for "${functionName}" at ${outFile}.`,
    );
  }

  return {
    assetPath: outRoot,
    handler: `index.${sourceExport}`,
  };
}

export const esbuildBuildProvider: BuildProvider = {
  mode: "esbuild",
  build({ functionName, fn }, context) {
    return buildWithEsbuild(
      functionName,
      fn.handler,
      fn.runtime,
      fn.build?.esbuild,
      context.cwd,
    );
  },
};
