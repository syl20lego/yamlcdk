import { z } from "zod";
import {
  dynamodbTableSchema,
  s3BucketSchema,
  snsTopicSchema,
  sqsQueueSchema,
} from "./domain-primitives.js";

export const s3DomainConfigSchema = z.object({
  buckets: z.record(z.string(), s3BucketSchema),
  cleanupRoleArn: z.string().min(1).optional(),
});

export const dynamodbDomainConfigSchema = z.object({
  tables: z.record(z.string(), dynamodbTableSchema),
});

export const sqsDomainConfigSchema = z.object({
  queues: z.record(z.string(), sqsQueueSchema),
});

export const snsDomainConfigSchema = z.object({
  topics: z.record(z.string(), snsTopicSchema),
});

export const apisDomainConfigSchema = z.object({
  restApi: z
    .object({
      cloudWatchRoleArn: z.string().min(1).optional(),
    })
    .optional(),
});
