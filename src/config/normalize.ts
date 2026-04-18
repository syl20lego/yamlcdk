import {
  normalizedServiceConfigSchema,
  type NormalizedServiceConfig,
  type RawServiceConfig,
} from "./schema.js";
import { normalizeYamlcdkDomainSections } from "./domain-schema-registry.js";
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
  const domainSections = normalizeYamlcdkDomainSections(raw);

  return normalizedServiceConfigSchema.parse({
    service: raw.service,
    provider: {
      ...provider,
      stage,
      region,
    },
    functions: raw.functions ?? {},
    storage: domainSections.storage,
    messaging: domainSections.messaging,
    iam: {
      statements: raw.iam?.statements ?? {},
    },
    cdn: domainSections.cdn,
    stackName,
  });
}
