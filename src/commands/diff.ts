import { loadModel } from "../config/loader.js";
import { assertModelResolution, resolveModelOverrides } from "../runtime/aws.js";
import { cdkDiff } from "../runtime/cdk.js";

export interface DiffOptions {
  config: string;
  region?: string;
  profile?: string;
  account?: string;
}

export function runDiff(options: DiffOptions): void {
  const model = resolveModelOverrides(loadModel(options.config), options);
  assertModelResolution(model);
  cdkDiff(model);
}
