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
import { DomainConfigs } from "./plugins/domain-configs.js";
import { deploymentConfigSchema as sharedDeploymentConfigSchema } from "../schema/deployment.js";
import { iamStatementSchema as sharedIamStatementSchema } from "../schema/iam.js";
import { buildConfigSchema as sharedBuildConfigSchema } from "../schema/build.js";
import {
  functionUrlAuthTypeSchema as sharedFunctionUrlAuthTypeSchema,
  functionUrlCorsSchema as sharedFunctionUrlCorsSchema,
  functionUrlHttpMethodSchema as sharedFunctionUrlHttpMethodSchema,
  functionUrlInvokeModeSchema as sharedFunctionUrlInvokeModeSchema,
} from "../schema/function-url.js";

// ─── Deployment ─────────────────────────────────────────────

export const deploymentConfigSchema = sharedDeploymentConfigSchema;
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

export const iamStatementSchema = sharedIamStatementSchema;
export type IamStatement = z.infer<typeof iamStatementSchema>;

export const iamConfigSchema = z.object({
  statements: z.record(z.string(), iamStatementSchema),
});

export type IamConfig = z.infer<typeof iamConfigSchema>;

// ─── Functions ──────────────────────────────────────────────

export const buildConfigSchema = sharedBuildConfigSchema;
export type BuildConfig = z.infer<typeof buildConfigSchema>;

export const functionUrlAuthTypeSchema = sharedFunctionUrlAuthTypeSchema;
export type FunctionUrlAuthType = z.infer<typeof functionUrlAuthTypeSchema>;

export const functionUrlInvokeModeSchema = sharedFunctionUrlInvokeModeSchema;
export type FunctionUrlInvokeMode = z.infer<typeof functionUrlInvokeModeSchema>;

export const functionUrlHttpMethodSchema = sharedFunctionUrlHttpMethodSchema;

export const functionUrlCorsSchema = sharedFunctionUrlCorsSchema;
export type FunctionUrlCorsConfig = z.infer<typeof functionUrlCorsSchema>;

export const functionUrlConfigSchema = z.object({
  authType: functionUrlAuthTypeSchema,
  cors: functionUrlCorsSchema.optional(),
  invokeMode: functionUrlInvokeModeSchema,
});

export type FunctionUrlConfig = z.infer<typeof functionUrlConfigSchema>;

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
  z
    .object({
      type: z.literal("eventbridge"),
      schedule: z.string().min(1).optional(),
      eventPattern: z.record(z.string(), z.unknown()).optional(),
    })
    .refine(
      (value) => value.schedule !== undefined || value.eventPattern !== undefined,
      {
        message:
          'EventBridge event must define at least one of "schedule" or "eventPattern".',
      },
    ),
]);

export type EventDeclaration = z.infer<typeof eventDeclarationSchema>;

export const functionModelSchema = z.object({
  handler: z.string().min(1),
  runtime: z.string().optional(),
  timeout: z.number().int().min(1).max(900).optional(),
  memorySize: z.number().int().min(128).max(10240).optional(),
  environment: z.record(z.string(), z.string()).optional(),
  iam: z.array(z.string()).optional(),
  url: functionUrlConfigSchema.optional(),
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
    throw new Error("ServiceModel must include a DomainConfigs instance.");
  }
  const domainConfigs = (input as { domainConfigs: unknown }).domainConfigs;
  if (!(domainConfigs instanceof DomainConfigs)) {
    throw new Error("ServiceModel must include a DomainConfigs instance.");
  }
  const parsed = serviceModelSchema.parse(input);
  return { ...parsed, domainConfigs };
}
