import {
  normalizedServiceConfigSchema,
  type NormalizedServiceConfig,
  type RawServiceConfig,
} from "./schema.js";
export type { NormalizedServiceConfig } from "./schema.js";

function sanitizeName(input: string): string {
  return input.replace(/[^a-zA-Z0-9-]/g, "-").toLowerCase();
}

export function normalizeConfig(raw: RawServiceConfig): NormalizedServiceConfig {
  const provider = raw.provider ?? {};
  const stage = provider.stage ?? "dev";
  const region = provider.region ?? process.env.AWS_REGION ?? "us-east-1";
  const stackName =
    provider.stackName ?? `${sanitizeName(raw.service)}-${sanitizeName(stage)}`;

  return normalizedServiceConfigSchema.parse({
    service: raw.service,
    provider: {
      ...provider,
      stage,
      region,
    },
    functions: raw.functions ?? {},
    storage: {
      s3: raw.storage?.s3 ?? {},
      dynamodb: raw.storage?.dynamodb ?? {},
    },
    messaging: {
      sqs: raw.messaging?.sqs ?? {},
      sns: raw.messaging?.sns ?? {},
    },
    iam: {
      statements: raw.iam?.statements ?? {},
    },
    cdn: {
      cachePolicies: raw.cdn?.cachePolicies ?? {},
      originRequestPolicies: raw.cdn?.originRequestPolicies ?? {},
      distributions: raw.cdn?.distributions ?? {},
    },
    stackName,
  });
}
