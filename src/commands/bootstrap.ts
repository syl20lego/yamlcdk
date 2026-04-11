import { loadModel } from "../config/loader.js";
import { assertModelResolution, resolveModelOverrides} from "../runtime/aws.js";
import { cdkBootstrap } from "../runtime/cdk.js";

export interface BootstrapOptions {
  config: string;
  region?: string;
  profile?: string;
  account?: string;
  opt?: Record<string, unknown>;
}

export function runBootstrap(options: BootstrapOptions): void {
  const model = resolveModelOverrides(
    loadModel(options.config, { opt: options.opt }),
    options,
  );
  assertModelResolution(model);
  cdkBootstrap(model);
}
