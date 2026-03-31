/**
 * Canonical compiler model — format-agnostic representation of a service.
 *
 * **Zod schemas are the single source of truth.**
 * TypeScript types are derived via `z.infer<>` so runtime
 * validation and compile-time types can never drift apart.
 *
 * Definition plugins (yamlcdk.yml, serverless.yml, cloudformation.yml, …)
 * parse their source format and produce a {@link ServiceModel}.
 * Domain plugins consume it during compilation without knowing
 * which definition format produced it.
 */

import { z } from "zod";
import type { DomainConfigs } from "./plugins/domain-configs.js";

// ─── Deployment ─────────────────────────────────────────────

export const deploymentConfigSchema = z.object({
  fileAssetsBucketName: z.string().min(1).optional(),
  imageAssetsRepositoryName: z.string().min(1).optional(),
  cloudFormationServiceRoleArn: z.string().min(1).optional(),
  cloudFormationExecutionRoleArn: z.string().min(1).optional(),
  deployRoleArn: z.string().min(1).optional(),
  qualifier: z.string().min(1).optional(),
  useCliCredentials: z.boolean().optional(),
  requireBootstrap: z.boolean().optional(),
});

export type DeploymentConfig = z.infer<typeof deploymentConfigSchema>;

// ─── Provider ───────────────────────────────────────────────

export const providerConfigSchema = z.object({
  region: z.string().min(1),
  stage: z.string().min(1),
  account: z.string().optional(),
  profile: z.string().optional(),
  tags: z.record(z.string(), z.string()).optional(),
  deployment: deploymentConfigSchema.optional(),
});

export type ProviderConfig = z.infer<typeof providerConfigSchema>;

// ─── IAM ────────────────────────────────────────────────────

export const iamStatementSchema = z.object({
  sid: z.string().optional(),
  effect: z.enum(["Allow", "Deny"]).optional(),
  actions: z.array(z.string()).min(1),
  resources: z.array(z.string()).min(1),
});

export type IamStatement = z.infer<typeof iamStatementSchema>;

export const iamConfigSchema = z.object({
  statements: z.record(z.string(), iamStatementSchema),
});

export type IamConfig = z.infer<typeof iamConfigSchema>;

// ─── Functions ──────────────────────────────────────────────

export const buildConfigSchema = z.object({
  mode: z.enum(["typescript", "external", "none"]).optional(),
  command: z.string().min(1).optional(),
  cwd: z.string().min(1).optional(),
  handler: z.string().min(1).optional(),
});

export type BuildConfig = z.infer<typeof buildConfigSchema>;

/**
 * Model-level event declarations.
 *
 * Each variant describes what a function subscribes to.
 * The definition plugin resolves all format-specific defaults
 * (e.g. global vs per-function apiKeyRequired) so these values
 * are final by the time they reach domain plugins.
 */
export const eventDeclarationSchema = z.discriminatedUnion("type", [
  z.object({
    type: z.literal("http"),
    method: z.string().min(1),
    path: z.string().min(1),
  }),
  z.object({
    type: z.literal("rest"),
    method: z.string().min(1),
    path: z.string().min(1),
    apiKeyRequired: z.boolean(),
  }),
  z.object({
    type: z.literal("s3"),
    bucket: z.string().min(1),
    events: z.array(z.string().min(1)).min(1),
  }),
  z.object({
    type: z.literal("sqs"),
    queue: z.string().min(1),
    batchSize: z.number().int().min(1).max(10000).optional(),
  }),
  z.object({
    type: z.literal("sns"),
    topic: z.string().min(1),
  }),
  z.object({
    type: z.literal("dynamodb-stream"),
    table: z.string().min(1),
    batchSize: z.number().int().min(1).max(10000).optional(),
    startingPosition: z.string().optional(),
  }),
  z.object({
    type: z.literal("eventbridge"),
    schedule: z.string().optional(),
    eventPattern: z.record(z.string(), z.unknown()).optional(),
  }),
]);

export type EventDeclaration = z.infer<typeof eventDeclarationSchema>;

export const functionModelSchema = z.object({
  handler: z.string().min(1),
  runtime: z.string().optional(),
  timeout: z.number().int().min(1).max(900).optional(),
  memorySize: z.number().int().min(128).max(10240).optional(),
  environment: z.record(z.string(), z.string()).optional(),
  iam: z.array(z.string()).optional(),
  build: buildConfigSchema.optional(),
  events: z.array(eventDeclarationSchema),
});

export type FunctionModel = z.infer<typeof functionModelSchema>;

// ─── Service model (top-level) ──────────────────────────────

/**
 * Schema for the serializable portion of the service model.
 *
 * `domainConfigs` is a runtime class instance and cannot be
 * expressed in Zod; use {@link parseServiceModel} to validate
 * the serializable fields plus an instanceof check.
 */
export const serviceModelSchema = z.object({
  service: z.string().min(1),
  stackName: z.string().min(1),
  provider: providerConfigSchema,
  functions: z.record(z.string(), functionModelSchema),
  iam: iamConfigSchema,
});

/** Serializable portion of the service model (no domainConfigs). */
export type ServiceModelData = z.infer<typeof serviceModelSchema>;

/**
 * The canonical, format-agnostic service model.
 *
 * Everything the compiler needs to synthesize a CloudFormation
 * stack is expressed here.  Domain-specific configuration lives
 * in {@link DomainConfigs} so the model stays open to new
 * domains without changing this interface.
 */
export interface ServiceModel extends ServiceModelData {
  readonly domainConfigs: DomainConfigs;
}

/**
 * Validate a ServiceModel at runtime.
 *
 * Parses all serializable fields through Zod and verifies
 * that `domainConfigs` is present.  Throws on invalid data.
 */
export function parseServiceModel(input: unknown): ServiceModel {
  if (
    input === null ||
    typeof input !== "object" ||
    !("domainConfigs" in input)
  ) {
    throw new Error("ServiceModel must include a domainConfigs instance.");
  }
  const parsed = serviceModelSchema.parse(input);
  return { ...parsed, domainConfigs: (input as ServiceModel).domainConfigs };
}
