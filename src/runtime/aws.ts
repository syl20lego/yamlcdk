import { z } from "zod";
import { normalizedServiceConfigSchema } from "../config/schema.js";
import type { NormalizedServiceConfig } from "../config/normalize.js";
import type { ServiceModel } from "../compiler/model.js";
import { parseServiceModel } from "../compiler/model.js";

export interface AwsResolutionInput {
  region?: string;
  profile?: string;
  account?: string;
}

const awsResolutionInputSchema = z.object({
  region: z.string().min(1).optional(),
  profile: z.string().min(1).optional(),
  account: z.string().min(1).optional(),
});

export function resolveAwsConfig(
  config: NormalizedServiceConfig,
  input: AwsResolutionInput,
): NormalizedServiceConfig {
  const resolvedInput = awsResolutionInputSchema.parse(input);
  return normalizedServiceConfigSchema.parse({
    ...config,
    provider: {
      ...config.provider,
      region: resolvedInput.region ?? config.provider.region,
      profile: resolvedInput.profile ?? config.provider.profile,
      account: resolvedInput.account ?? config.provider.account,
    },
  });
}

export function assertAwsResolution(config: NormalizedServiceConfig): void {
  if (!config.provider.region) {
    throw new Error(
      "AWS region is required. Provide --region, provider.region, or AWS_REGION.",
    );
  }
}

/** Resolve CLI overrides onto a ServiceModel. */
export function resolveModelOverrides(
  model: ServiceModel,
  input: AwsResolutionInput,
): ServiceModel {
  const resolvedInput = awsResolutionInputSchema.parse(input);
  return parseServiceModel({
    ...model,
    provider: {
      ...model.provider,
      region: resolvedInput.region ?? model.provider.region,
      profile: resolvedInput.profile ?? model.provider.profile,
      account: resolvedInput.account ?? model.provider.account,
    },
  });
}

/** Assert that a ServiceModel has enough AWS context to operate. */
export function assertModelResolution(model: ServiceModel): void {
  if (!model.provider.region) {
    throw new Error(
      "AWS region is required. Provide --region, provider.region, or AWS_REGION.",
    );
  }
}
