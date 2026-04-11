import { loadModel } from "../config/loader.js";
import { assertModelResolution } from "../runtime/aws.js";

export function runValidate(
  configPath: string,
  opt?: Record<string, unknown>,
): void {
  const model = loadModel(configPath, { opt });
  assertModelResolution(model);
  process.stdout.write(`Config valid: ${configPath}\n`);
}
