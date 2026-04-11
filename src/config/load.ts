import fs from "node:fs";
import yaml from "js-yaml";
import { validateServiceConfig } from "./schema.js";
import type { RawServiceConfig } from "./schema.js";
import { resolveDefinitionVariables } from "../definitions/variables/resolve.js";

export function loadRawConfig(filePath: string): RawServiceConfig {
  const raw = fs.readFileSync(filePath, "utf8");
  const parsed = yaml.load(raw);
  const resolved = resolveDefinitionVariables(parsed, {
    entryFilePath: filePath,
    parseContent: (content) => yaml.load(content),
  });
  return validateServiceConfig(resolved);
}
