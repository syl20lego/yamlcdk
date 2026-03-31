import fs from "node:fs";
import path from "node:path";
import { definitionRegistry } from "../definitions/registry.js";

export function runInit(configPath: string, format: string = "yamlcdk"): void {
  if (fs.existsSync(configPath)) {
    throw new Error(`Config file already exists: ${configPath}`);
  }

  const plugin = definitionRegistry.all().find((p) => p.formatName === format);
  if (!plugin) {
    const supported = definitionRegistry
      .all()
      .map((p) => p.formatName)
      .join(", ");
    throw new Error(
      `Unknown format: "${format}". Supported formats: ${supported}`,
    );
  }
  if (!plugin.generateStarter) {
    throw new Error(`Format "${format}" does not support starter generation.`);
  }

  const content = plugin.generateStarter();
  fs.mkdirSync(path.dirname(configPath), { recursive: true });
  fs.writeFileSync(configPath, content, "utf8");
  process.stdout.write(`Created starter config at ${configPath}\n`);
}
