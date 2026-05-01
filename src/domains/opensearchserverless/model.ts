import { z } from "zod";
import { createDomainConfigKey } from "../../compiler/plugins/domain-configs.js";

const cfnIntrinsicSchema = z.record(z.string(), z.unknown());
const tokenStringSchema = z.union([z.string().min(1), cfnIntrinsicSchema]);

export type TokenString = z.infer<typeof tokenStringSchema>;

export const openSearchPolicyDocumentSchema = z.union([
  z.string().min(1),
  z.record(z.string(), z.unknown()),
  z.array(z.unknown()),
]);

export type OpenSearchPolicyDocument = z.infer<typeof openSearchPolicyDocumentSchema>;

export const openSearchCollectionConfigSchema = z.object({
  name: tokenStringSchema.optional(),
  description: z.string().optional(),
  type: z.string().min(1).optional(),
  standbyReplicas: z.string().min(1).optional(),
  collectionGroupName: z.string().min(1).optional(),
  encryptionConfig: cfnIntrinsicSchema.optional(),
  vectorOptions: cfnIntrinsicSchema.optional(),
  tags: z.record(z.string(), z.string()).optional(),
});

export type OpenSearchCollectionConfig = z.infer<
  typeof openSearchCollectionConfigSchema
>;

export const openSearchAccessPolicyConfigSchema = z.object({
  name: tokenStringSchema.optional(),
  description: z.string().optional(),
  type: z.string().min(1).default("data"),
  policy: openSearchPolicyDocumentSchema,
});

export type OpenSearchAccessPolicyConfig = z.infer<
  typeof openSearchAccessPolicyConfigSchema
>;

export const openSearchSecurityPolicyConfigSchema = z.object({
  name: tokenStringSchema.optional(),
  description: z.string().optional(),
  type: z.string().min(1),
  policy: openSearchPolicyDocumentSchema,
});

export type OpenSearchSecurityPolicyConfig = z.infer<
  typeof openSearchSecurityPolicyConfigSchema
>;

export const openSearchVpcEndpointConfigSchema = z.object({
  name: tokenStringSchema.optional(),
  vpcId: tokenStringSchema,
  subnetIds: z.array(tokenStringSchema).min(1),
  securityGroupIds: z.array(tokenStringSchema).optional(),
});

export type OpenSearchVpcEndpointConfig = z.infer<
  typeof openSearchVpcEndpointConfigSchema
>;

export const openSearchServerlessDomainConfigSchema = z.object({
  collections: z.record(z.string(), openSearchCollectionConfigSchema).default({}),
  accessPolicies: z.record(z.string(), openSearchAccessPolicyConfigSchema).default(
    {},
  ),
  securityPolicies: z.record(
    z.string(),
    openSearchSecurityPolicyConfigSchema,
  ).default({}),
  vpcEndpoints: z.record(z.string(), openSearchVpcEndpointConfigSchema).default(
    {},
  ),
  autoCreatePolicies: z.boolean().default(false),
});

export type OpenSearchServerlessDomainConfig = z.infer<
  typeof openSearchServerlessDomainConfigSchema
>;

export const openSearchYamlcdkStorageSchema =
  openSearchServerlessDomainConfigSchema;

export const OPENSEARCH_SERVERLESS_CONFIG = createDomainConfigKey(
  "opensearchserverless",
  openSearchServerlessDomainConfigSchema,
);
