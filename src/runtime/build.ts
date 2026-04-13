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
  /** When set, use Code.fromInline() instead of Code.fromAsset(). */
  inline?: string;
}

function ensureDir(dir: string): void {
  fs.mkdirSync(dir, { recursive: true });
}

function resolveTypeScriptSourcePath(sourceModulePath: string): string {
  const absoluteModulePath = path.resolve(process.cwd(), sourceModulePath);
  if (path.extname(absoluteModulePath)) {
    return absoluteModulePath;
  }

  const candidates = [
    `${absoluteModulePath}.ts`,
    `${absoluteModulePath}.tsx`,
    `${absoluteModulePath}.mts`,
    `${absoluteModulePath}.cts`,
  ];
  const matched = candidates.find((candidate) => fs.existsSync(candidate));
  if (matched) {
    return matched;
  }

  return absoluteModulePath;
}

function findNearestTsconfig(fromDir: string): string | undefined {
  let dir = fromDir;
  while (true) {
    const candidate = path.join(dir, "tsconfig.json");
    if (fs.existsSync(candidate)) return candidate;
    const parent = path.dirname(dir);
    if (parent === dir) return undefined;
    dir = parent;
  }
}

function compileTypeScriptHandler(
  functionName: string,
  sourceHandler: string,
): BuildResult {
  const [sourceModulePath, sourceExport = "handler"] = sourceHandler.split(".");
  const absSource = resolveTypeScriptSourcePath(sourceModulePath);
  const outRoot = path.resolve(process.cwd(), ".yamlcdk-build", functionName);
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
    { encoding: "utf8", cwd: process.cwd() },
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

  const relCompiled = `${path.parse(absSource).name}.js`;
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

export interface PrepareFunctionBuildsOptions {
  /** When true, return inline stubs instead of compiling real handlers. */
  readonly stub?: boolean;
}

const STUB_INLINE_CODE =
  "exports.handler = async () => ({ statusCode: 200, body: 'validation' });";

export function prepareFunctionBuilds(
  config: BuildableConfig,
  options?: PrepareFunctionBuildsOptions,
): Record<string, BuildResult> {
  if (options?.stub) {
    const output: Record<string, BuildResult> = {};
    for (const name of Object.keys(config.functions)) {
      output[name] = { assetPath: "", handler: "index.handler", inline: STUB_INLINE_CODE };
    }
    return output;
  }

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
