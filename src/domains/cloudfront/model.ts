import { z } from "zod";
import { createDomainConfigKey } from "../../compiler/plugins/domain-configs.js";

export const cachePolicyCacheHeaderBehaviorSchema = z.enum(["none", "whitelist"]);
export const cachePolicyCacheCookieBehaviorSchema = z.enum([
  "none",
  "all",
  "whitelist",
  "allExcept",
]);
export const cachePolicyCacheQueryStringBehaviorSchema = z.enum([
  "none",
  "all",
  "whitelist",
  "allExcept",
]);

export const cachePolicyConfigSchema = z.object({
  comment: z.string().optional(),
  defaultTtl: z.number().int().min(0).optional(),
  minTtl: z.number().int().min(0).optional(),
  maxTtl: z.number().int().min(0).optional(),
  headersConfig: z
    .object({
      behavior: cachePolicyCacheHeaderBehaviorSchema,
      headers: z.array(z.string().min(1)).optional(),
    })
    .optional(),
  cookiesConfig: z
    .object({
      behavior: cachePolicyCacheCookieBehaviorSchema,
      cookies: z.array(z.string().min(1)).optional(),
    })
    .optional(),
  queryStringsConfig: z
    .object({
      behavior: cachePolicyCacheQueryStringBehaviorSchema,
      queryStrings: z.array(z.string().min(1)).optional(),
    })
    .optional(),
  enableGzip: z.boolean().optional(),
  enableBrotli: z.boolean().optional(),
});

export type CloudFrontCachePolicyConfig = z.infer<typeof cachePolicyConfigSchema>;

export const originRequestPolicyHeaderBehaviorSchema = z.enum([
  "none",
  "allViewer",
  "whitelist",
  "allViewerAndWhitelistCloudFront",
]);
export const originRequestPolicyCookieBehaviorSchema = z.enum([
  "none",
  "all",
  "whitelist",
  "allExcept",
]);
export const originRequestPolicyQueryStringBehaviorSchema = z.enum([
  "none",
  "all",
  "whitelist",
]);

export const originRequestPolicyConfigSchema = z.object({
  comment: z.string().optional(),
  headersConfig: z
    .object({
      behavior: originRequestPolicyHeaderBehaviorSchema,
      headers: z.array(z.string().min(1)).optional(),
    })
    .optional(),
  cookiesConfig: z
    .object({
      behavior: originRequestPolicyCookieBehaviorSchema,
      cookies: z.array(z.string().min(1)).optional(),
    })
    .optional(),
  queryStringsConfig: z
    .object({
      behavior: originRequestPolicyQueryStringBehaviorSchema,
      queryStrings: z.array(z.string().min(1)).optional(),
    })
    .optional(),
});

export type CloudFrontOriginRequestPolicyConfig = z.infer<typeof originRequestPolicyConfigSchema>;

export const distributionOriginSchema = z.object({
  id: z.string().min(1),
  domainName: z.union([z.string().min(1), z.record(z.string(), z.unknown())]),
  httpPort: z.number().int().min(1).max(65535).optional(),
  httpsPort: z.number().int().min(1).max(65535).optional(),
  originProtocolPolicy: z
    .enum(["http-only", "https-only", "match-viewer"])
    .optional(),
});

export const distributionBehaviorSchema = z.object({
  targetOriginId: z.string().min(1),
  viewerProtocolPolicy: z.enum(["https-only", "redirect-to-https", "allow-all"]),
  cachePolicyId: z.string().optional(),
  originRequestPolicyId: z.string().optional(),
  allowedMethods: z.array(z.string().min(1)).optional(),
  compress: z.boolean().optional(),
  pathPattern: z.string().min(1).optional(),
});

export const distributionConfigSchema = z.object({
  comment: z.string().optional(),
  enabled: z.boolean().optional(),
  priceClass: z
    .enum(["PriceClass_All", "PriceClass_200", "PriceClass_100"])
    .optional(),
  httpVersion: z.enum(["http1.1", "http2", "http2and3", "http3"]).optional(),
  origins: z.array(distributionOriginSchema).min(1),
  defaultBehavior: distributionBehaviorSchema,
  additionalBehaviors: z.array(distributionBehaviorSchema).optional(),
  domainNames: z.array(z.string().min(1)).optional(),
  certificateArn: z.string().optional(),
  webAclId: z.string().optional(),
});

export type CloudFrontDistributionConfig = z.infer<typeof distributionConfigSchema>;

export const cloudfrontYamlcdkCachePoliciesSchema = z.record(
  z.string(),
  cachePolicyConfigSchema,
);
export const cloudfrontYamlcdkOriginRequestPoliciesSchema = z.record(
  z.string(),
  originRequestPolicyConfigSchema,
);
export const cloudfrontYamlcdkDistributionsSchema = z.record(
  z.string(),
  distributionConfigSchema,
);

export const cloudfrontDomainConfigSchema = z.object({
  cachePolicies: cloudfrontYamlcdkCachePoliciesSchema,
  originRequestPolicies: cloudfrontYamlcdkOriginRequestPoliciesSchema,
  distributions: cloudfrontYamlcdkDistributionsSchema,
});

export type CloudFrontDomainConfig = z.infer<typeof cloudfrontDomainConfigSchema>;

export const CLOUDFRONT_CONFIG = createDomainConfigKey(
  "cloudfront",
  cloudfrontDomainConfigSchema,
);
