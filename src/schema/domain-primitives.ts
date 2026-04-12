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

// ─── CloudFront ──────────────────────────────────────────────

export const cachePolicyCacheHeaderBehaviorSchema = z.enum(["none", "whitelist"]);
export const cachePolicyCacheCookieBehaviorSchema = z.enum(["none", "all", "whitelist", "allExcept"]);
export const cachePolicyCacheQueryStringBehaviorSchema = z.enum(["none", "all", "whitelist", "allExcept"]);

export const cachePolicySchema = z.object({
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

export const originRequestPolicyHeaderBehaviorSchema = z.enum([
  "none",
  "allViewer",
  "whitelist",
  "allViewerAndWhitelistCloudFront",
]);
export const originRequestPolicyCookieBehaviorSchema = z.enum(["none", "all", "whitelist", "allExcept"]);
export const originRequestPolicyQueryStringBehaviorSchema = z.enum(["none", "all", "whitelist"]);

export const originRequestPolicySchema = z.object({
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

export const distributionOriginSchema = z.object({
  id: z.string().min(1),
  domainName: z.string().min(1),
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

export const distributionSchema = z.object({
  comment: z.string().optional(),
  enabled: z.boolean().optional(),
  priceClass: z.enum(["PriceClass_All", "PriceClass_200", "PriceClass_100"]).optional(),
  httpVersion: z.enum(["http1.1", "http2", "http2and3", "http3"]).optional(),
  origins: z.array(distributionOriginSchema).min(1),
  defaultBehavior: distributionBehaviorSchema,
  additionalBehaviors: z.array(distributionBehaviorSchema).optional(),
  domainNames: z.array(z.string().min(1)).optional(),
  certificateArn: z.string().optional(),
  webAclId: z.string().optional(),
});
