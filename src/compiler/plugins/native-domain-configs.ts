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
import {
  apisDomainConfigSchema as sharedApisDomainConfigSchema,
  cloudfrontDomainConfigSchema as sharedCloudfrontDomainConfigSchema,
  dynamodbDomainConfigSchema as sharedDynamodbDomainConfigSchema,
  s3DomainConfigSchema as sharedS3DomainConfigSchema,
  snsDomainConfigSchema as sharedSnsDomainConfigSchema,
  sqsDomainConfigSchema as sharedSqsDomainConfigSchema,
} from "../../schema/domain-configs.js";
import {
  cachePolicySchema as sharedCachePolicySchema,
  distributionSchema as sharedDistributionSchema,
  dynamodbKeySchema as sharedDynamodbKeySchema,
  dynamodbTableSchema as sharedDynamodbTableSchema,
  originRequestPolicySchema as sharedOriginRequestPolicySchema,
  s3BucketSchema as sharedS3BucketSchema,
  snsSubscriptionSchema as sharedSnsSubscriptionSchema,
  snsTopicSchema as sharedSnsTopicSchema,
  sqsQueueSchema as sharedSqsQueueSchema,
} from "../../schema/domain-primitives.js";

// ─── S3 ─────────────────────────────────────────────────────

export const s3BucketConfigSchema = sharedS3BucketSchema;

export type S3BucketConfig = z.infer<typeof s3BucketConfigSchema>;

export const s3DomainConfigSchema = sharedS3DomainConfigSchema;

export type S3DomainConfig = z.infer<typeof s3DomainConfigSchema>;

export const S3_CONFIG = createDomainConfigKey("s3", s3DomainConfigSchema);

// ─── DynamoDB ───────────────────────────────────────────────

export const dynamodbKeySchemaSchema = sharedDynamodbKeySchema;

export type DynamoDBKeySchema = z.infer<typeof dynamodbKeySchemaSchema>;

export const dynamodbTableConfigSchema = sharedDynamodbTableSchema;

export type DynamoDBTableConfig = z.infer<typeof dynamodbTableConfigSchema>;

export const dynamodbDomainConfigSchema = sharedDynamodbDomainConfigSchema;

export type DynamoDBDomainConfig = z.infer<typeof dynamodbDomainConfigSchema>;

export const DYNAMODB_CONFIG = createDomainConfigKey(
  "dynamodb",
  dynamodbDomainConfigSchema,
);

// ─── SQS ────────────────────────────────────────────────────

export const sqsQueueConfigSchema = sharedSqsQueueSchema;

export type SQSQueueConfig = z.infer<typeof sqsQueueConfigSchema>;

export const sqsDomainConfigSchema = sharedSqsDomainConfigSchema;

export type SQSDomainConfig = z.infer<typeof sqsDomainConfigSchema>;

export const SQS_CONFIG = createDomainConfigKey("sqs", sqsDomainConfigSchema);

// ─── SNS ────────────────────────────────────────────────────

export const snsSubscriptionConfigSchema = sharedSnsSubscriptionSchema;

export type SNSSubscriptionConfig = z.infer<typeof snsSubscriptionConfigSchema>;

export const snsTopicConfigSchema = sharedSnsTopicSchema;

export type SNSTopicConfig = z.infer<typeof snsTopicConfigSchema>;

export const snsDomainConfigSchema = sharedSnsDomainConfigSchema;

export type SNSDomainConfig = z.infer<typeof snsDomainConfigSchema>;

export const SNS_CONFIG = createDomainConfigKey("sns", snsDomainConfigSchema);

// ─── APIs (HTTP + REST API Gateway) ─────────────────────────

export const apisDomainConfigSchema = sharedApisDomainConfigSchema;

export type ApisDomainConfig = z.infer<typeof apisDomainConfigSchema>;

export const APIS_CONFIG = createDomainConfigKey(
  "apis",
  apisDomainConfigSchema,
);

// ─── CloudFront ──────────────────────────────────────────────

export const cachePolicyConfigSchema = sharedCachePolicySchema;

export type CloudFrontCachePolicyConfig = z.infer<typeof cachePolicyConfigSchema>;

export const originRequestPolicyConfigSchema = sharedOriginRequestPolicySchema;

export type CloudFrontOriginRequestPolicyConfig = z.infer<typeof originRequestPolicyConfigSchema>;

export const distributionConfigSchema = sharedDistributionSchema;

export type CloudFrontDistributionConfig = z.infer<typeof distributionConfigSchema>;

export const cloudfrontDomainConfigSchema = sharedCloudfrontDomainConfigSchema;

export type CloudFrontDomainConfig = z.infer<typeof cloudfrontDomainConfigSchema>;

export const CLOUDFRONT_CONFIG = createDomainConfigKey(
  "cloudfront",
  cloudfrontDomainConfigSchema,
);
