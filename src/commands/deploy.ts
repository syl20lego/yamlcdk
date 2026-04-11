import { loadModel } from "../config/loader.js";
import { assertModelResolution, resolveModelOverrides } from "../runtime/aws.js";
import { cdkDeploy } from "../runtime/cdk.js";

export interface DeployOptions {
  config: string;
  region?: string;
  profile?: string;
  account?: string;
  requireApproval?: boolean;
  opt?: Record<string, unknown>;
}

export function runDeploy(options: DeployOptions): void {
  const model = resolveModelOverrides(
    loadModel(options.config, { opt: options.opt }),
    options,
  );
  assertModelResolution(model);
  cdkDeploy(model, options.requireApproval ?? false);
}
