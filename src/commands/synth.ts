import { loadModel } from "../config/loader.js";
import { assertModelResolution, resolveModelOverrides } from "../runtime/aws.js";
import { cdkSynth } from "../runtime/cdk.js";

export interface SynthOptions {
  config: string;
  region?: string;
  profile?: string;
  account?: string;
  opt?: Record<string, unknown>;
}

export function runSynth(options: SynthOptions): void {
  const model = resolveModelOverrides(
    loadModel(options.config, { opt: options.opt }),
    options,
  );
  assertModelResolution(model);
  cdkSynth(model);
}
