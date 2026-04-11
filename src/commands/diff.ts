import { loadModel } from "../config/loader.js";
import { assertModelResolution, resolveModelOverrides } from "../runtime/aws.js";
import { cdkDiff } from "../runtime/cdk.js";

export interface DiffOptions {
  config: string;
  region?: string;
  profile?: string;
  account?: string;
  opt?: Record<string, unknown>;
}

export function runDiff(options: DiffOptions): void {
  const model = resolveModelOverrides(
    loadModel(options.config, { opt: options.opt }),
    options,
  );
  assertModelResolution(model);
  cdkDiff(model);
}
