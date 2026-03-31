import fs from "node:fs";
import path from "node:path";
import { spawnSync } from "node:child_process";
/** Minimal config shape needed for function builds. */
export interface BuildableConfig {
  readonly functions: Readonly<
    Record<
      string,
      {
        readonly handler: string;
        readonly build?: {
          readonly mode?: string;
          readonly command?: string;
          readonly cwd?: string;
          readonly handler?: string;
        };
      }
    >
  >;
}

export interface BuildResult {
  assetPath: string;
  handler: string;
}

function ensureDir(dir: string): void {
  fs.mkdirSync(dir, { recursive: true });
}

function compileTypeScriptHandler(
  functionName: string,
  sourceHandler: string,
): BuildResult {
  const [sourceModulePath, sourceExport = "handler"] = sourceHandler.split(".");
  const absSource = path.resolve(process.cwd(), sourceModulePath);
  const outRoot = path.resolve(process.cwd(), ".yamlcdk-build", functionName);
  ensureDir(outRoot);

  const result = spawnSync(
    "npx",
    [
      "tsc",
      absSource,
      "--module",
      "commonjs",
      "--target",
      "es2022",
      "--esModuleInterop",
      "--skipLibCheck",
      "--outDir",
      outRoot,
    ],
    { encoding: "utf8", cwd: process.cwd() },
  );

  if (result.status !== 0) {
    throw new Error(
      `TypeScript build failed for function "${functionName}".\n${result.stdout ?? ""}\n${result.stderr ?? ""}`,
    );
  }

  const relCompiled = `${path.basename(sourceModulePath)}.js`;
  const compiledFile = path.join(outRoot, relCompiled);
  if (!fs.existsSync(compiledFile)) {
    throw new Error(
      `TypeScript build did not produce expected file for "${functionName}": ${compiledFile}`,
    );
  }

  return {
    assetPath: outRoot,
    handler: `${path.parse(relCompiled).name}.${sourceExport}`,
  };
}

function runExternalBuild(
  functionName: string,
  command: string,
  cwd?: string,
  handlerOverride?: string,
): BuildResult {
  const result = spawnSync(command, {
    cwd: cwd ? path.resolve(process.cwd(), cwd) : process.cwd(),
    encoding: "utf8",
    shell: true,
  });
  if (result.status !== 0) {
    throw new Error(
      `External build failed for function "${functionName}".\nCommand: ${command}\n${result.stdout ?? ""}\n${result.stderr ?? ""}`,
    );
  }
  if (!handlerOverride) {
    throw new Error(
      `Function "${functionName}" uses external build but no build.handler was provided.`,
    );
  }
  const [modulePath, exportName = "handler"] = handlerOverride.split(".");
  const absModulePath = path.resolve(process.cwd(), modulePath);
  const assetPath = path.dirname(absModulePath);
  if (!fs.existsSync(`${absModulePath}.js`) && !fs.existsSync(absModulePath)) {
    throw new Error(
      `External build output for "${functionName}" not found at ${absModulePath}(.js).`,
    );
  }

  return {
    assetPath,
    handler: `${path.basename(modulePath)}.${exportName}`,
  };
}

export function prepareFunctionBuilds(
  config: BuildableConfig,
): Record<string, BuildResult> {
  const output: Record<string, BuildResult> = {};
  for (const [functionName, fn] of Object.entries(config.functions)) {
    const mode = fn.build?.mode ?? "typescript";
    if (mode === "external") {
      if (!fn.build?.command) {
        throw new Error(
          `Function "${functionName}" build.mode=external requires build.command.`,
        );
      }
      output[functionName] = runExternalBuild(
        functionName,
        fn.build.command,
        fn.build.cwd,
        fn.build.handler ?? fn.handler,
      );
      continue;
    }

    if (mode === "none") {
      const [modulePath, exportName = "handler"] = fn.handler.split(".");
      const absModulePath = path.resolve(process.cwd(), modulePath);
      const assetPath = path.dirname(absModulePath);
      output[functionName] = {
        assetPath,
        handler: `${path.basename(modulePath)}.${exportName}`,
      };
      continue;
    }

    output[functionName] = compileTypeScriptHandler(functionName, fn.handler);
  }
  return output;
}
