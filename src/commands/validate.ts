import { loadModel } from "../config/loader.js";
import { assertModelResolution } from "../runtime/aws.js";

export function runValidate(configPath: string): void {
  const model = loadModel(configPath);
  assertModelResolution(model);
  process.stdout.write(`Config valid: ${configPath}\n`);
}
