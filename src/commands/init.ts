import fs from "node:fs";
import path from "node:path";
import { yamlcdkDefinitionPlugin } from "../definitions/yamlcdk/index.js";

export function runInit(configPath: string): void {
  if (fs.existsSync(configPath)) {
    throw new Error(`Config file already exists: ${configPath}`);
  }

  const content = yamlcdkDefinitionPlugin.generateStarter!();
  fs.mkdirSync(path.dirname(configPath), { recursive: true });
  fs.writeFileSync(configPath, content, "utf8");
  process.stdout.write(`Created starter config at ${configPath}\n`);
}
