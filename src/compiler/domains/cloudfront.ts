import * as cloudfront from "aws-cdk-lib/aws-cloudfront";
import * as origins from "aws-cdk-lib/aws-cloudfront-origins";
import * as acm from "aws-cdk-lib/aws-certificatemanager";
import cdk from "aws-cdk-lib";
import { tryGetLogicalId } from "../stack/helpers.js";
import { CLOUDFRONT_CONFIG } from "../plugins/index.js";
import type {
  CloudFrontCachePolicyConfig,
  CloudFrontDistributionConfig,
  CloudFrontOriginRequestPolicyConfig,
} from "../plugins/index.js";
import type { DomainPlugin, DomainValidationContribution } from "../plugins/index.js";

// UUID pattern — used to detect managed (pre-existing) policy IDs
const UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function isUuid(value: string): boolean {
  return UUID_RE.test(value);
}

function buildCacheHeaderBehavior(
  config: CloudFrontCachePolicyConfig["headersConfig"],
): cloudfront.CacheHeaderBehavior {
  if (!config || config.behavior === "none") {
    return cloudfront.CacheHeaderBehavior.none();
  }
  // whitelist: if no headers provided, treat as none instead of failing
  if (!config.headers || config.headers.length === 0) {
    return cloudfront.CacheHeaderBehavior.none();
  }
  return cloudfront.CacheHeaderBehavior.allowList(...config.headers);
}

function buildCacheCookieBehavior(
  config: CloudFrontCachePolicyConfig["cookiesConfig"],
): cloudfront.CacheCookieBehavior {
  if (!config || config.behavior === "none") {
    return cloudfront.CacheCookieBehavior.none();
  }
  if (config.behavior === "all") {
    return cloudfront.CacheCookieBehavior.all();
  }
  if (config.behavior === "allExcept") {
    // denyList: if no cookies provided, treat as all instead of failing
    if (!config.cookies || config.cookies.length === 0) {
      return cloudfront.CacheCookieBehavior.all();
    }
    return cloudfront.CacheCookieBehavior.denyList(...config.cookies);
  }
  // whitelist: if no cookies provided, treat as none instead of failing
  if (!config.cookies || config.cookies.length === 0) {
    return cloudfront.CacheCookieBehavior.none();
  }
  return cloudfront.CacheCookieBehavior.allowList(...config.cookies);
}

function buildCacheQueryStringBehavior(
  config: CloudFrontCachePolicyConfig["queryStringsConfig"],
): cloudfront.CacheQueryStringBehavior {
  if (!config || config.behavior === "none") {
    return cloudfront.CacheQueryStringBehavior.none();
  }
  if (config.behavior === "all") {
    return cloudfront.CacheQueryStringBehavior.all();
  }
  if (config.behavior === "allExcept") {
    // denyList: if no queryStrings provided, treat as all instead of failing
    if (!config.queryStrings || config.queryStrings.length === 0) {
      return cloudfront.CacheQueryStringBehavior.all();
    }
    return cloudfront.CacheQueryStringBehavior.denyList(...config.queryStrings);
  }
  // whitelist: if no queryStrings provided, treat as none instead of failing
  if (!config.queryStrings || config.queryStrings.length === 0) {
    return cloudfront.CacheQueryStringBehavior.none();
  }
  return cloudfront.CacheQueryStringBehavior.allowList(...config.queryStrings);
}

function buildOriginRequestHeaderBehavior(
  config: CloudFrontOriginRequestPolicyConfig["headersConfig"],
): cloudfront.OriginRequestHeaderBehavior {
  if (!config || config.behavior === "none") {
    return cloudfront.OriginRequestHeaderBehavior.none();
  }
  if (config.behavior === "allViewer") {
    return cloudfront.OriginRequestHeaderBehavior.all();
  }
  if (config.behavior === "allViewerAndWhitelistCloudFront") {
    // denyList is the closest equivalent — forwards all viewer headers
    // except the listed CloudFront-specific ones
    return cloudfront.OriginRequestHeaderBehavior.denyList(
      ...(config.headers ?? []),
    );
  }
  // whitelist: if no headers provided, treat as none instead of failing
  if (!config.headers || config.headers.length === 0) {
    return cloudfront.OriginRequestHeaderBehavior.none();
  }
  return cloudfront.OriginRequestHeaderBehavior.allowList(...config.headers);
}

function buildOriginRequestCookieBehavior(
  config: CloudFrontOriginRequestPolicyConfig["cookiesConfig"],
): cloudfront.OriginRequestCookieBehavior {
  if (!config || config.behavior === "none") {
    return cloudfront.OriginRequestCookieBehavior.none();
  }
  if (config.behavior === "all") {
    return cloudfront.OriginRequestCookieBehavior.all();
  }
  if (config.behavior === "allExcept") {
    // denyList: if no cookies provided, treat as all instead of failing
    if (!config.cookies || config.cookies.length === 0) {
      return cloudfront.OriginRequestCookieBehavior.all();
    }
    return cloudfront.OriginRequestCookieBehavior.denyList(...config.cookies);
  }
  // whitelist: if no cookies provided, treat as none instead of failing
  if (!config.cookies || config.cookies.length === 0) {
    return cloudfront.OriginRequestCookieBehavior.none();
  }
  return cloudfront.OriginRequestCookieBehavior.allowList(...config.cookies);
}

function buildOriginRequestQueryStringBehavior(
  config: CloudFrontOriginRequestPolicyConfig["queryStringsConfig"],
): cloudfront.OriginRequestQueryStringBehavior {
  if (!config || config.behavior === "none") {
    return cloudfront.OriginRequestQueryStringBehavior.none();
  }
  if (config.behavior === "all") {
    return cloudfront.OriginRequestQueryStringBehavior.all();
  }
  // whitelist: if no queryStrings provided, treat as none instead of failing
  if (!config.queryStrings || config.queryStrings.length === 0) {
    return cloudfront.OriginRequestQueryStringBehavior.none();
  }
  return cloudfront.OriginRequestQueryStringBehavior.allowList(
    ...config.queryStrings,
  );
}

function toViewerProtocolPolicy(
  value: CloudFrontDistributionConfig["defaultBehavior"]["viewerProtocolPolicy"],
): cloudfront.ViewerProtocolPolicy {
  switch (value) {
    case "https-only":
      return cloudfront.ViewerProtocolPolicy.HTTPS_ONLY;
    case "redirect-to-https":
      return cloudfront.ViewerProtocolPolicy.REDIRECT_TO_HTTPS;
    case "allow-all":
      return cloudfront.ViewerProtocolPolicy.ALLOW_ALL;
  }
}

function toAllowedMethods(
  methods: string[] | undefined,
): cloudfront.AllowedMethods {
  if (!methods) return cloudfront.AllowedMethods.ALLOW_GET_HEAD;
  const upper = methods.map((m) => m.toUpperCase());
  const hasBody =
    upper.includes("POST") ||
    upper.includes("PUT") ||
    upper.includes("DELETE") ||
    upper.includes("PATCH");
  if (hasBody) return cloudfront.AllowedMethods.ALLOW_ALL;
  const hasOptions = upper.includes("OPTIONS");
  if (hasOptions) return cloudfront.AllowedMethods.ALLOW_GET_HEAD_OPTIONS;
  return cloudfront.AllowedMethods.ALLOW_GET_HEAD;
}

function toPriceClass(
  value: CloudFrontDistributionConfig["priceClass"],
): cloudfront.PriceClass {
  switch (value) {
    case "PriceClass_100":
      return cloudfront.PriceClass.PRICE_CLASS_100;
    case "PriceClass_200":
      return cloudfront.PriceClass.PRICE_CLASS_200;
    case "PriceClass_All":
    default:
      return cloudfront.PriceClass.PRICE_CLASS_ALL;
  }
}

function toHttpVersion(
  value: CloudFrontDistributionConfig["httpVersion"],
): cloudfront.HttpVersion {
  switch (value) {
    case "http1.1":
      return cloudfront.HttpVersion.HTTP1_1;
    case "http2and3":
      return cloudfront.HttpVersion.HTTP2_AND_3;
    case "http3":
      return cloudfront.HttpVersion.HTTP3;
    case "http2":
    default:
      return cloudfront.HttpVersion.HTTP2;
  }
}

function toOriginProtocolPolicy(
  value: NonNullable<
    CloudFrontDistributionConfig["origins"][number]["originProtocolPolicy"]
  >,
): cloudfront.OriginProtocolPolicy {
  switch (value) {
    case "http-only":
      return cloudfront.OriginProtocolPolicy.HTTP_ONLY;
    case "match-viewer":
      return cloudfront.OriginProtocolPolicy.MATCH_VIEWER;
    case "https-only":
    default:
      return cloudfront.OriginProtocolPolicy.HTTPS_ONLY;
  }
}

export const cloudfrontDomain: DomainPlugin = {
  name: "cloudfront",

  synthesize(ctx) {
    const config = ctx.model.domainConfigs.get(CLOUDFRONT_CONFIG);
    if (!config) return;

    // Synthesize CachePolicy constructs
    for (const [name, policyConfig] of Object.entries(config.cachePolicies)) {
      ctx.refs[name] = new cloudfront.CachePolicy(
        ctx.stack,
        `CachePolicy${name}`,
        {
          comment: policyConfig.comment,
          defaultTtl: cdk.Duration.seconds(policyConfig.defaultTtl ?? 86400),
          minTtl: cdk.Duration.seconds(policyConfig.minTtl ?? 0),
          maxTtl: cdk.Duration.seconds(policyConfig.maxTtl ?? 31536000),
          headerBehavior: buildCacheHeaderBehavior(policyConfig.headersConfig),
          cookieBehavior: buildCacheCookieBehavior(policyConfig.cookiesConfig),
          queryStringBehavior: buildCacheQueryStringBehavior(
            policyConfig.queryStringsConfig,
          ),
          enableAcceptEncodingGzip: policyConfig.enableGzip ?? true,
          enableAcceptEncodingBrotli: policyConfig.enableBrotli ?? true,
        },
      );
    }

    // Synthesize OriginRequestPolicy constructs
    for (const [name, policyConfig] of Object.entries(
      config.originRequestPolicies,
    )) {
      ctx.refs[name] = new cloudfront.OriginRequestPolicy(
        ctx.stack,
        `OriginRequestPolicy${name}`,
        {
          comment: policyConfig.comment,
          headerBehavior: buildOriginRequestHeaderBehavior(
            policyConfig.headersConfig,
          ),
          cookieBehavior: buildOriginRequestCookieBehavior(
            policyConfig.cookiesConfig,
          ),
          queryStringBehavior: buildOriginRequestQueryStringBehavior(
            policyConfig.queryStringsConfig,
          ),
        },
      );
    }

    // Synthesize Distribution constructs
    for (const [name, distConfig] of Object.entries(config.distributions)) {
      const originMap = new Map<string, cloudfront.IOrigin>();
      for (const originCfg of distConfig.origins) {
        const customOriginProps =
          originCfg.originProtocolPolicy !== undefined ||
          originCfg.httpPort !== undefined ||
          originCfg.httpsPort !== undefined
            ? {
                protocolPolicy: toOriginProtocolPolicy(
                  originCfg.originProtocolPolicy ?? "https-only",
                ),
                httpPort: originCfg.httpPort,
                httpsPort: originCfg.httpsPort,
              }
            : undefined;

        const domainName = cdk.Token.asString(originCfg.domainName);
        originMap.set(
          originCfg.id,
          customOriginProps
            ? new origins.HttpOrigin(domainName, customOriginProps)
            : new origins.HttpOrigin(domainName),
        );
      }

      const resolveCachePolicy = (
        id: string | undefined,
      ): cloudfront.ICachePolicy | undefined => {
        if (!id) return undefined;
        const ref = ctx.refs[id];
        if (ref && ref instanceof cloudfront.CachePolicy) return ref;
        if (isUuid(id)) {
          return cloudfront.CachePolicy.fromCachePolicyId(
            ctx.stack,
            `ImportedCachePolicy${id.replace(/-/g, "")}`,
            id,
          );
        }
        throw new Error(
          `CloudFront Distribution "${name}" references unknown CachePolicy "${id}". ` +
            `Define it in cachePolicies or use a managed policy UUID.`,
        );
      };

      const resolveOriginRequestPolicy = (
        id: string | undefined,
      ): cloudfront.IOriginRequestPolicy | undefined => {
        if (!id) return undefined;
        const ref = ctx.refs[id];
        if (ref && ref instanceof cloudfront.OriginRequestPolicy) return ref;
        if (isUuid(id)) {
          return cloudfront.OriginRequestPolicy.fromOriginRequestPolicyId(
            ctx.stack,
            `ImportedOriginRequestPolicy${id.replace(/-/g, "")}`,
            id,
          );
        }
        throw new Error(
          `CloudFront Distribution "${name}" references unknown OriginRequestPolicy "${id}". ` +
            `Define it in originRequestPolicies or use a managed policy UUID.`,
        );
      };

      const buildBehaviorOptions = (
        behavior: CloudFrontDistributionConfig["defaultBehavior"],
        originMap: Map<string, cloudfront.IOrigin>,
      ): cloudfront.BehaviorOptions & { origin: cloudfront.IOrigin } => {
        const origin = originMap.get(behavior.targetOriginId);
        if (!origin) {
          throw new Error(
            `CloudFront Distribution "${name}" defaultBehavior/additionalBehaviors references ` +
              `unknown origin "${behavior.targetOriginId}".`,
          );
        }
        return {
          origin,
          viewerProtocolPolicy: toViewerProtocolPolicy(
            behavior.viewerProtocolPolicy,
          ),
          cachePolicy: resolveCachePolicy(behavior.cachePolicyId),
          originRequestPolicy: resolveOriginRequestPolicy(
            behavior.originRequestPolicyId,
          ),
          allowedMethods: toAllowedMethods(behavior.allowedMethods),
          compress: behavior.compress,
        };
      };

      const defaultBehaviorOptions = buildBehaviorOptions(
        distConfig.defaultBehavior,
        originMap,
      );

      const additionalBehaviors: Record<
        string,
        cloudfront.BehaviorOptions
      > = {};
      for (const ab of distConfig.additionalBehaviors ?? []) {
        const pattern = ab.pathPattern;
        if (!pattern) {
          throw new Error(
            `CloudFront Distribution "${name}" additionalBehaviors entry is missing pathPattern.`,
          );
        }
        additionalBehaviors[pattern] = buildBehaviorOptions(ab, originMap);
      }

      const certificate = distConfig.certificateArn
        ? acm.Certificate.fromCertificateArn(
            ctx.stack,
            `Distribution${name}Certificate`,
            distConfig.certificateArn,
          )
        : undefined;

      const distribution = new cloudfront.Distribution(
        ctx.stack,
        `Distribution${name}`,
        {
          comment: distConfig.comment,
          enabled: distConfig.enabled ?? true,
          priceClass: toPriceClass(distConfig.priceClass),
          httpVersion: toHttpVersion(distConfig.httpVersion),
          domainNames: distConfig.domainNames,
          certificate,
          webAclId: distConfig.webAclId,
          defaultBehavior: defaultBehaviorOptions,
          additionalBehaviors:
            Object.keys(additionalBehaviors).length > 0
              ? additionalBehaviors
              : undefined,
        },
      );

      ctx.refs[name] = distribution;

      new cdk.CfnOutput(ctx.stack, `Distribution${name}DomainName`, {
        value: distribution.distributionDomainName,
      });
    }
  },

  bind(_ctx, _events) {
    // CloudFront does not participate in Lambda event binding
  },

  describeValidation(ctx) {
    const config = ctx.model.domainConfigs.get(CLOUDFRONT_CONFIG);
    if (!config) return [];

    const contributions: DomainValidationContribution[] = [];

    for (const [name, distConfig] of Object.entries(config.distributions)) {
      const ref = ctx.refs[name];
      if (!ref || !(ref instanceof cloudfront.Distribution)) {
        continue;
      }
      const logicalId = tryGetLogicalId(ctx.stack, ref);
      if (!logicalId) {
        continue;
      }

      contributions.push({
        section: "Resources",
        logicalId,
        description: `CloudFront distribution "${name}"`,
        properties: {
          domainName: ref.distributionDomainName,
          aliases: distConfig.domainNames ?? [],
          enabled: distConfig.enabled ?? true,
          priceClass: distConfig.priceClass ?? "PriceClass_All",
          httpVersion: distConfig.httpVersion ?? "http2",
          defaultOriginId: distConfig.defaultBehavior.targetOriginId,
          originCount: distConfig.origins.length,
          origins: distConfig.origins.map((origin) =>
            cdk.Token.asString(origin.domainName),
          ),
          additionalBehaviorCount:
            distConfig.additionalBehaviors?.length ?? 0,
          viewerProtocolPolicy:
            distConfig.defaultBehavior.viewerProtocolPolicy,
          ...(distConfig.webAclId
            ? { webAclId: distConfig.webAclId }
            : {}),
        },
        status: "valid",
      });
    }

    return contributions;
  },
};
