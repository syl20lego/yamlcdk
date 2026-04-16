import { z } from "zod";
import { createDomainConfigKey } from "../../compiler/plugins/domain-configs.js";
import {
  dynamodbKeySchema as sharedDynamodbKeySchema,
  dynamodbTableSchema as sharedDynamodbTableSchema,
} from "../../schema/domain-primitives.js";

export const dynamodbKeySchema = sharedDynamodbKeySchema;

export type DynamoDBKeySchema = z.infer<typeof dynamodbKeySchema>;

export const dynamodbTableConfigSchema = sharedDynamodbTableSchema;

export type DynamoDBTableConfig = z.infer<typeof dynamodbTableConfigSchema>;

export const dynamodbDomainConfigSchema = z.object({
  tables: z.record(z.string(), dynamodbTableConfigSchema),
});

export type DynamoDBDomainConfig = z.infer<typeof dynamodbDomainConfigSchema>;

export const DYNAMODB_CONFIG = createDomainConfigKey(
  "dynamodb",
  dynamodbDomainConfigSchema,
);

