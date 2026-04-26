import { z } from "zod";
import {
  functionUrlAuthTypeSchema,
  functionUrlCorsSchema,
  functionUrlInvokeModeSchema,
} from "../schema/function-url.js";
import { iamStatementSchema as sharedIamStatementSchema } from "../schema/iam.js";
import { buildConfigSchema } from "../schema/build.js";
import { deploymentConfigSchema } from "../schema/deployment.js";
import {
  cfnGetAttEnvSchema,
  cfnRefEnvSchema,
  envValueSchema,
} from "../schema/cfn-env.js";
import { dynamodbTableConfigSchema } from "../domains/dynamodb/model.js";
import {
  createNormalizedYamlcdkDomainSectionSchemas,
  createRawYamlcdkDomainSectionSchemas,
} from "./domain-schema-registry.js";

export const runtimeSchema = z.enum(["nodejs20.x", "nodejs22.x", 'nodejs24.x']);

export const iamStatementSchema = sharedIamStatementSchema;

const functionUrlSchema = z.object({
  authType: functionUrlAuthTypeSchema.optional(),
  cors: functionUrlCorsSchema.optional(),
  invokeMode: functionUrlInvokeModeSchema.optional(),
});

const eventBusReferenceSchema = z.union([
  z.string().min(1),
  cfnRefEnvSchema,
  cfnGetAttEnvSchema,
]);

export const functionSchema = z.object({
  handler: z.string().min(1),
  runtime: runtimeSchema.optional(),
  timeout: z.number().int().min(1).max(900).optional(),
  memorySize: z.number().int().min(128).max(10240).optional(),
  environment: z.record(z.string(), envValueSchema).optional(),
  iam: z.array(z.string()).optional(),
  url: functionUrlSchema.optional(),
  build: buildConfigSchema.optional(),
  events: z
    .object({
      http: z
        .array(
          z.object({
            method: z.string().min(1),
            path: z.string().min(1),
          }),
        )
        .optional(),
      rest: z
        .array(
          z.object({
            method: z.string().min(1),
            path: z.string().min(1),
          }),
        )
        .optional(),
      s3: z
        .array(
          z.object({
            bucket: z.string().min(1),
            events: z.array(z.string().min(1)).min(1),
          }),
        )
        .optional(),
      sqs: z
        .array(
          z.object({
            queue: z.string().min(1),
            batchSize: z.number().int().min(1).max(10000).optional(),
          }),
        )
        .optional(),
      sns: z
        .array(
          z.object({
            topic: z.string().min(1),
          }),
        )
        .optional(),
      dynamodb: z
        .array(
          z.object({
            table: z.string().min(1),
            batchSize: z.number().int().min(1).max(10000).optional(),
            startingPosition: z.enum(["LATEST", "TRIM_HORIZON"]).optional(),
          }),
        )
        .optional(),
      eventbridge: z
        .array(
          z
            .object({
              schedule: z.string().min(1).optional(),
              eventPattern: z.record(z.string(), z.unknown()).optional(),
              eventBus: eventBusReferenceSchema.optional(),
            })
            .refine(
              (v) => v.schedule !== undefined || v.eventPattern !== undefined,
              {
                message:
                  'EventBridge event must define at least one of "schedule" or "eventPattern".',
              },
            ),
        )
        .optional(),
    })
    .optional(),
  restApi: z
    .object({
      apiKeyRequired: z.boolean().optional(),
    })
    .optional(),
});

const rawYamlcdkDomainSections = createRawYamlcdkDomainSectionSchemas();
const normalizedYamlcdkDomainSections =
  createNormalizedYamlcdkDomainSectionSchemas();

export const tableSchema = dynamodbTableConfigSchema;

export const serviceConfigSchema = z.object({
  service: z.string().min(1),
  provider: z
    .object({
      region: z.string().optional(),
      stage: z.string().optional(),
      account: z.string().optional(),
      profile: z.string().optional(),
      stackName: z.string().optional(),
      tags: z.record(z.string(), z.string()).optional(),
      s3: z
        .object({
          cleanupRoleArn: z.string().min(1).optional(),
        })
        .optional(),
      restApi: z
        .object({
          apiKeyRequired: z.boolean().optional(),
          cloudWatchRoleArn: z.string().min(1).optional(),
        })
        .optional(),
      deployment: deploymentConfigSchema.optional(),
    })
    .optional(),
  functions: z.record(z.string(), functionSchema).optional(),
  storage: rawYamlcdkDomainSections.storage,
  messaging: rawYamlcdkDomainSections.messaging,
  iam: z
    .object({
      statements: z.record(z.string(), iamStatementSchema).optional(),
    })
    .optional(),
  cdn: rawYamlcdkDomainSections.cdn,
});

export const normalizedServiceConfigSchema = z.object({
  service: z.string().min(1),
  provider: z.object({
    region: z.string().min(1),
    stage: z.string().min(1),
    account: z.string().optional(),
    profile: z.string().optional(),
    stackName: z.string().optional(),
    tags: z.record(z.string(), z.string()).optional(),
    s3: z
      .object({
        cleanupRoleArn: z.string().min(1).optional(),
      })
      .optional(),
    restApi: z
      .object({
        apiKeyRequired: z.boolean().optional(),
        cloudWatchRoleArn: z.string().min(1).optional(),
      })
      .optional(),
    deployment: deploymentConfigSchema.optional(),
  }),
  functions: z.record(z.string(), functionSchema),
  storage: normalizedYamlcdkDomainSections.storage,
  messaging: normalizedYamlcdkDomainSections.messaging,
  iam: z.object({
    statements: z.record(z.string(), iamStatementSchema),
  }),
  cdn: normalizedYamlcdkDomainSections.cdn,
  stackName: z.string().min(1),
});

export type RawServiceConfig = z.infer<typeof serviceConfigSchema>;
export type IamStatementConfig = z.infer<typeof iamStatementSchema>;
export type NormalizedServiceConfig = z.infer<
  typeof normalizedServiceConfigSchema
>;

export function validateServiceConfig(input: unknown): RawServiceConfig {
  const parsed = serviceConfigSchema.safeParse(input);
  if (!parsed.success) {
    const details = parsed.error.issues
      .map((i) => `${i.path.join(".") || "<root>"}: ${i.message}`)
      .join("\n");
    throw new Error(`Invalid YAML config:\n${details}`);
  }
  return parsed.data;
}
