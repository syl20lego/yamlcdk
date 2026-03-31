import { loadModel } from "../config/loader.js";
import { assertModelResolution, resolveModelOverrides } from "../runtime/aws.js";
import { cdkDeploy } from "../runtime/cdk.js";

export interface DeployOptions {
  config: string;
  region?: string;
  profile?: string;
  account?: string;
  requireApproval?: boolean;
}

export function runDeploy(options: DeployOptions): void {
  const model = resolveModelOverrides(loadModel(options.config), options);
  assertModelResolution(model);
  cdkDeploy(model, options.requireApproval ?? false);
}
