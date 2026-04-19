import fs from "node:fs";
import path from "node:path";
import { spawnSync } from "node:child_process";
import type { BuildProvider } from "./contracts.js";
import {
  ensureDir,
  findNearestTsconfig,
  resolveCompiledOutputPath,
  resolveOutRoot,
  resolveSourcePath,
  splitHandler,
  toHandlerModulePath,
} from "./shared.js";

const TS_SOURCE_EXTENSIONS = [".ts", ".tsx", ".mts", ".cts"] as const;

function compileTypeScriptHandler(
  functionName: string,
  sourceHandler: string,
  cwd: string,
): {
  assetPath: string;
  handler: string;
} {
  const { modulePath: sourceModulePath, exportName: sourceExport } =
    splitHandler(sourceHandler);
  const absSource = resolveSourcePath(sourceModulePath, cwd, TS_SOURCE_EXTENSIONS);
  const outRoot = resolveOutRoot(cwd, functionName);
  ensureDir(outRoot);

  const nearestTsconfig = findNearestTsconfig(path.dirname(absSource));
  const tsconfigContent: Record<string, unknown> = {
    compilerOptions: {
      module: "commonjs",
      moduleResolution: "node",
      skipLibCheck: true,
      outDir: outRoot,
      noEmit: false,
      declaration: false,
      emitDeclarationOnly: false,
      sourceMap: false,
    },
    files: [absSource],
  };
  if (nearestTsconfig) {
    tsconfigContent.extends = nearestTsconfig;
  } else {
    (tsconfigContent.compilerOptions as Record<string, unknown>).target = "es2022";
    (tsconfigContent.compilerOptions as Record<string, unknown>).esModuleInterop = true;
  }

  const tmpTsconfig = path.join(outRoot, "tsconfig.build.json");
  fs.writeFileSync(tmpTsconfig, JSON.stringify(tsconfigContent), "utf8");

  const result = spawnSync(
    "npx",
    ["tsc", "--project", tmpTsconfig],
    { encoding: "utf8", cwd },
  );

  try {
    fs.unlinkSync(tmpTsconfig);
  } catch {
    // Best-effort cleanup
  }

  if (result.status !== 0) {
    throw new Error(
      `TypeScript build failed for function "${functionName}".\n${result.stdout ?? ""}\n${result.stderr ?? ""}`,
    );
  }

  const compiledFile = resolveCompiledOutputPath(outRoot, absSource);
  if (!compiledFile || !fs.existsSync(compiledFile)) {
    throw new Error(
      `TypeScript build did not produce expected runtime file for "${functionName}" in ${outRoot}.`,
    );
  }
  const handlerModulePath = toHandlerModulePath(outRoot, compiledFile);

  return {
    assetPath: outRoot,
    handler: `${handlerModulePath}.${sourceExport}`,
  };
}

export const typescriptBuildProvider: BuildProvider = {
  mode: "typescript",
  build({ functionName, fn }, context) {
    return compileTypeScriptHandler(functionName, fn.handler, context.cwd);
  },
};
