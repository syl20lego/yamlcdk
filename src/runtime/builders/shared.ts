import fs from "node:fs";
import path from "node:path";

export function ensureDir(dir: string): void {
  fs.mkdirSync(dir, { recursive: true });
}

export function splitHandler(handler: string): {
  modulePath: string;
  exportName: string;
} {
  const [modulePath, exportName = "handler"] = handler.split(".");
  return { modulePath, exportName };
}

export function resolveOutRoot(cwd: string, functionName: string): string {
  return path.resolve(cwd, ".yamlcdk", "build", functionName);
}

export function resolveSourcePath(
  sourceModulePath: string,
  cwd: string,
  extensions: readonly string[],
): string {
  const absoluteModulePath = path.resolve(cwd, sourceModulePath);
  if (path.extname(absoluteModulePath)) {
    return absoluteModulePath;
  }

  const candidates = extensions.map((extension) => `${absoluteModulePath}${extension}`);
  const matched = candidates.find((candidate) => fs.existsSync(candidate));
  if (matched) {
    return matched;
  }

  return absoluteModulePath;
}

export function findNearestTsconfig(fromDir: string): string | undefined {
  let dir = fromDir;
  while (true) {
    const candidate = path.join(dir, "tsconfig.json");
    if (fs.existsSync(candidate)) return candidate;
    const parent = path.dirname(dir);
    if (parent === dir) return undefined;
    dir = parent;
  }
}

function walkFiles(root: string): string[] {
  const entries = fs.readdirSync(root, { withFileTypes: true });
  const files: string[] = [];
  for (const entry of entries) {
    const fullPath = path.join(root, entry.name);
    if (entry.isDirectory()) {
      files.push(...walkFiles(fullPath));
      continue;
    }
    files.push(fullPath);
  }
  return files;
}

export function resolveCompiledOutputPath(
  outRoot: string,
  absSource: string,
): string | undefined {
  const baseName = path.parse(absSource).name;
  const directCandidates = [
    path.join(outRoot, `${baseName}.js`),
    path.join(outRoot, `${baseName}.mjs`),
    path.join(outRoot, `${baseName}.cjs`),
  ];
  const directMatch = directCandidates.find((candidate) => fs.existsSync(candidate));
  if (directMatch) return directMatch;

  const emittedFiles = walkFiles(outRoot)
    .filter((filePath) => /\.(mjs|cjs|js)$/i.test(filePath))
    .filter((filePath) => path.parse(filePath).name === baseName);
  if (emittedFiles.length === 0) return undefined;

  emittedFiles.sort((a, b) => {
    const depthA = path.relative(outRoot, a).split(path.sep).length;
    const depthB = path.relative(outRoot, b).split(path.sep).length;
    if (depthA !== depthB) return depthA - depthB;

    const extOrder = (value: string): number => {
      if (value.endsWith(".js")) return 0;
      if (value.endsWith(".mjs")) return 1;
      if (value.endsWith(".cjs")) return 2;
      return 3;
    };
    return extOrder(a) - extOrder(b);
  });

  return emittedFiles[0];
}

export function toHandlerModulePath(outRoot: string, compiledFile: string): string {
  const relativePath = path.relative(outRoot, compiledFile);
  const withoutExt = relativePath.replace(/\.(mjs|cjs|js)$/i, "");
  return withoutExt.split(path.sep).join("/");
}
