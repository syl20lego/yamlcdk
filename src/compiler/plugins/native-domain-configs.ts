/**
 * Domain config keys, Zod schemas, and types for every native/bundled domain.
 *
 * **Zod schemas are the single source of truth.**
 * TypeScript types are derived via `z.infer<>`.
 *
 * These are the shared contract between definition plugins
 * (which populate the store) and domain plugins (which read it).
 */

import { z } from "zod";
import { createDomainConfigKey } from "./domain-configs.js";

// ─── S3 ─────────────────────────────────────────────────────

export const s3BucketConfigSchema = z.object({
  versioned: z.boolean().optional(),
  autoDeleteObjects: z.boolean().optional(),
});

export type S3BucketConfig = z.infer<typeof s3BucketConfigSchema>;

export const s3DomainConfigSchema = z.object({
  buckets: z.record(z.string(), s3BucketConfigSchema),
  cleanupRoleArn: z.string().min(1).optional(),
});

export type S3DomainConfig = z.infer<typeof s3DomainConfigSchema>;

export const S3_CONFIG = createDomainConfigKey("s3", s3DomainConfigSchema);

// ─── DynamoDB ───────────────────────────────────────────────

export const dynamodbKeySchemaSchema = z.object({
  name: z.string().min(1),
  type: z.enum(["string", "number", "binary"]),
});

export type DynamoDBKeySchema = z.infer<typeof dynamodbKeySchemaSchema>;

export const dynamodbTableConfigSchema = z.object({
  partitionKey: dynamodbKeySchemaSchema,
  sortKey: dynamodbKeySchemaSchema.optional(),
  billingMode: z.enum(["PAY_PER_REQUEST", "PROVISIONED"]).optional(),
  stream: z
    .enum(["NEW_IMAGE", "OLD_IMAGE", "NEW_AND_OLD_IMAGES", "KEYS_ONLY"])
    .optional(),
});

export type DynamoDBTableConfig = z.infer<typeof dynamodbTableConfigSchema>;

export const dynamodbDomainConfigSchema = z.object({
  tables: z.record(z.string(), dynamodbTableConfigSchema),
});

export type DynamoDBDomainConfig = z.infer<typeof dynamodbDomainConfigSchema>;

export const DYNAMODB_CONFIG = createDomainConfigKey(
  "dynamodb",
  dynamodbDomainConfigSchema,
);

// ─── SQS ────────────────────────────────────────────────────

export const sqsQueueConfigSchema = z.object({
  visibilityTimeout: z.number().int().min(0).max(43200).optional(),
});

export type SQSQueueConfig = z.infer<typeof sqsQueueConfigSchema>;

export const sqsDomainConfigSchema = z.object({
  queues: z.record(z.string(), sqsQueueConfigSchema),
});

export type SQSDomainConfig = z.infer<typeof sqsDomainConfigSchema>;

export const SQS_CONFIG = createDomainConfigKey("sqs", sqsDomainConfigSchema);

// ─── SNS ────────────────────────────────────────────────────

export const snsSubscriptionConfigSchema = z.object({
  type: z.literal("sqs"),
  target: z.string().min(1),
});

export type SNSSubscriptionConfig = z.infer<typeof snsSubscriptionConfigSchema>;

export const snsTopicConfigSchema = z.object({
  subscriptions: z.array(snsSubscriptionConfigSchema).optional(),
});

export type SNSTopicConfig = z.infer<typeof snsTopicConfigSchema>;

export const snsDomainConfigSchema = z.object({
  topics: z.record(z.string(), snsTopicConfigSchema),
});

export type SNSDomainConfig = z.infer<typeof snsDomainConfigSchema>;

export const SNS_CONFIG = createDomainConfigKey("sns", snsDomainConfigSchema);

// ─── APIs (HTTP + REST API Gateway) ─────────────────────────

export const apisDomainConfigSchema = z.object({
  restApi: z
    .object({
      cloudWatchRoleArn: z.string().min(1).optional(),
    })
    .optional(),
});

export type ApisDomainConfig = z.infer<typeof apisDomainConfigSchema>;

export const APIS_CONFIG = createDomainConfigKey(
  "apis",
  apisDomainConfigSchema,
);
