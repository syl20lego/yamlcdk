import { loadModel } from "../config/loader.js";
import { assertModelResolution, resolveModelOverrides } from "../runtime/aws.js";
import { cdkValidate, type ValidateOutputFormat } from "../runtime/cdk.js";

export interface ValidateOptions {
  config: string;
  region?: string;
  profile?: string;
  account?: string;
  output?: string;
  opt?: Record<string, unknown>;
}

function resolveOutputFormat(value?: string): ValidateOutputFormat {
  const normalized = value?.toLowerCase() ?? "text";
  if (normalized === "text" || normalized === "json") {
    return normalized;
  }
  throw new Error(
    `Unsupported output format "${value}". Use --output text or --output json.`,
  );
}

export function runValidate(options: ValidateOptions): void {
  const model = resolveModelOverrides(
    loadModel(options.config, { opt: options.opt }),
    options,
  );
  assertModelResolution(model);
  cdkValidate(model, resolveOutputFormat(options.output));
}
