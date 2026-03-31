import { loadModel } from "../config/loader.js";
import { assertModelResolution, resolveModelOverrides } from "../runtime/aws.js";
import { cdkDestroy } from "../runtime/cdk.js";

export interface RemoveOptions {
  config: string;
  region?: string;
  profile?: string;
  account?: string;
  force?: boolean;
}

export function runRemove(options: RemoveOptions): void {
  const model = resolveModelOverrides(loadModel(options.config), options);
  assertModelResolution(model);
  cdkDestroy(model, options.force ?? false);
}
