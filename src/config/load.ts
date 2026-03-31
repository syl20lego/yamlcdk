import fs from "node:fs";
import yaml from "js-yaml";
import { validateServiceConfig } from "./schema.js";
import type { RawServiceConfig } from "./schema.js";

export function loadRawConfig(filePath: string): RawServiceConfig {
  const raw = fs.readFileSync(filePath, "utf8");
  const parsed = yaml.load(raw);
  return validateServiceConfig(parsed);
}
