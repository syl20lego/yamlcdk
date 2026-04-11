import fs from "node:fs";
import yaml from "js-yaml";
import { validateServiceConfig } from "./schema.js";
import type { RawServiceConfig } from "./schema.js";
import { resolveDefinitionVariables } from "../definitions/variables/resolve.js";

interface LoadRawConfigOptions {
  opt?: Record<string, unknown>;
}

export function loadRawConfig(
  filePath: string,
  options: LoadRawConfigOptions = {},
): RawServiceConfig {
  const raw = fs.readFileSync(filePath, "utf8");
  const parsed = yaml.load(raw);
  const resolved = resolveDefinitionVariables(parsed, {
    entryFilePath: filePath,
    parseContent: (content) => yaml.load(content),
    opt: options.opt,
  });
  return validateServiceConfig(resolved);
}
