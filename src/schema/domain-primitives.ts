import { z } from "zod";

export const dynamodbKeySchema = z.object({
  name: z.string().min(1),
  type: z.enum(["string", "number", "binary"]),
});

export const dynamodbTableSchema = z.object({
  partitionKey: dynamodbKeySchema,
  sortKey: dynamodbKeySchema.optional(),
  billingMode: z.enum(["PAY_PER_REQUEST", "PROVISIONED"]).optional(),
  removalPolicy: z.enum(["DESTROY", "RETAIN"]).optional(),
  stream: z
    .enum(["NEW_IMAGE", "OLD_IMAGE", "NEW_AND_OLD_IMAGES", "KEYS_ONLY"])
    .optional(),
});

export const s3BucketSchema = z.object({
  versioned: z.boolean().optional(),
  autoDeleteObjects: z.boolean().optional(),
});

export const sqsQueueSchema = z.object({
  visibilityTimeout: z.number().int().min(0).max(43200).optional(),
});

export const snsSubscriptionSchema = z.object({
  type: z.literal("sqs"),
  target: z.string().min(1),
});

export const snsTopicSchema = z.object({
  subscriptions: z.array(snsSubscriptionSchema).optional(),
});
