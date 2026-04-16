import { z } from "zod";
import { createDomainConfigKey } from "../../compiler/plugins/domain-configs.js";
import {
  cachePolicySchema as sharedCachePolicySchema,
  distributionSchema as sharedDistributionSchema,
  originRequestPolicySchema as sharedOriginRequestPolicySchema,
} from "../../schema/domain-primitives.js";

export const cachePolicyConfigSchema = sharedCachePolicySchema;

export type CloudFrontCachePolicyConfig = z.infer<typeof cachePolicyConfigSchema>;

export const originRequestPolicyConfigSchema = sharedOriginRequestPolicySchema;

export type CloudFrontOriginRequestPolicyConfig = z.infer<typeof originRequestPolicyConfigSchema>;

export const distributionConfigSchema = sharedDistributionSchema;

export type CloudFrontDistributionConfig = z.infer<typeof distributionConfigSchema>;

export const cloudfrontDomainConfigSchema = z.object({
  cachePolicies: z.record(z.string(), cachePolicyConfigSchema),
  originRequestPolicies: z.record(z.string(), originRequestPolicyConfigSchema),
  distributions: z.record(z.string(), distributionConfigSchema),
});

export type CloudFrontDomainConfig = z.infer<typeof cloudfrontDomainConfigSchema>;

export const CLOUDFRONT_CONFIG = createDomainConfigKey(
  "cloudfront",
  cloudfrontDomainConfigSchema,
);

