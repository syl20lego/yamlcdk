import { z } from "zod";
import { createDomainConfigKey } from "../../compiler/plugins/domain-configs.js";
export const dynamodbKeySchema = z.object({
  name: z.string().min(1),
  type: z.enum(["string", "number", "binary"]),
});

export type DynamoDBKeySchema = z.infer<typeof dynamodbKeySchema>;

export const dynamodbTableConfigSchema = z.object({
  partitionKey: dynamodbKeySchema,
  sortKey: dynamodbKeySchema.optional(),
  billingMode: z.enum(["PAY_PER_REQUEST", "PROVISIONED"]).optional(),
  removalPolicy: z.enum(["DESTROY", "RETAIN"]).optional(),
  stream: z
    .enum(["NEW_IMAGE", "OLD_IMAGE", "NEW_AND_OLD_IMAGES", "KEYS_ONLY"])
    .optional(),
});

export type DynamoDBTableConfig = z.infer<typeof dynamodbTableConfigSchema>;

export const dynamodbYamlcdkStorageSchema = z.record(
  z.string(),
  dynamodbTableConfigSchema,
);

export const dynamodbDomainConfigSchema = z.object({
  tables: dynamodbYamlcdkStorageSchema,
});

export type DynamoDBDomainConfig = z.infer<typeof dynamodbDomainConfigSchema>;

export const DYNAMODB_CONFIG = createDomainConfigKey(
  "dynamodb",
  dynamodbDomainConfigSchema,
);
