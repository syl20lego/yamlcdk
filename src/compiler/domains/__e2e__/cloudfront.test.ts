import { Match } from "aws-cdk-lib/assertions";
import { describe, expect, test } from "vitest";
import { synthServiceConfig } from "./helpers.js";
import { DomainConfigs } from "../../plugins/index.js";
import { CLOUDFRONT_CONFIG } from "../../plugins/native-domain-configs.js";
import { buildApp } from "../../stack-builder.js";
import { normalizeConfig } from "../../../config/normalize.js";
import { validateServiceConfig } from "../../../config/schema.js";
import { Template } from "aws-cdk-lib/assertions";

function synthWithCloudFront(
  cdn: NonNullable<Parameters<typeof validateServiceConfig>[0]["cdn"]>,
) {
  const raw = validateServiceConfig({ service: "demo", cdn });
  const config = normalizeConfig(raw);
  const { stack } = buildApp(config);
  return Template.fromStack(stack);
}

describe("cloudfront domain e2e", () => {
  describe("CachePolicy", () => {
    test("creates a CachePolicy with default settings", () => {
      const template = synthWithCloudFront({
        cachePolicies: {
          apiCache: {},
        },
        originRequestPolicies: {},
        distributions: {},
      });

      template.resourceCountIs("AWS::CloudFront::CachePolicy", 1);
    });

    test("creates a CachePolicy with all-querystring behavior", () => {
      const template = synthWithCloudFront({
        cachePolicies: {
          apiCache: {
            comment: "Cache API",
            defaultTtl: 0,
            minTtl: 0,
            maxTtl: 31536000,
            queryStringsConfig: { behavior: "all" },
          },
        },
        originRequestPolicies: {},
        distributions: {},
      });

      template.hasResourceProperties(
        "AWS::CloudFront::CachePolicy",
        Match.objectLike({
          CachePolicyConfig: Match.objectLike({
            Comment: "Cache API",
          }),
        }),
      );
    });
  });

  describe("OriginRequestPolicy", () => {
    test("creates an OriginRequestPolicy with allViewer headers", () => {
      const template = synthWithCloudFront({
        cachePolicies: {},
        originRequestPolicies: {
          allViewerPolicy: {
            headersConfig: { behavior: "allViewer" },
          },
        },
        distributions: {},
      });

      template.resourceCountIs("AWS::CloudFront::OriginRequestPolicy", 1);
    });
  });

  describe("Distribution", () => {
    test("creates a Distribution with a custom HTTP origin and redirect-to-https", () => {
      const template = synthWithCloudFront({
        cachePolicies: {},
        originRequestPolicies: {},
        distributions: {
          myDist: {
            comment: "My CDN",
            origins: [
              {
                id: "webOrigin",
                domainName: "example.com",
                originProtocolPolicy: "https-only",
                httpsPort: 443,
              },
            ],
            defaultBehavior: {
              targetOriginId: "webOrigin",
              viewerProtocolPolicy: "redirect-to-https",
            },
          },
        },
      });

      template.resourceCountIs("AWS::CloudFront::Distribution", 1);
      template.hasOutput("DistributionmyDistDomainName", {});
    });

    test("references a synthesized CachePolicy by logical name", () => {
      const template = synthWithCloudFront({
        cachePolicies: {
          apiCache: {
            defaultTtl: 0,
            queryStringsConfig: { behavior: "all" },
          },
        },
        originRequestPolicies: {},
        distributions: {
          myDist: {
            origins: [
              {
                id: "webOrigin",
                domainName: "example.com",
              },
            ],
            defaultBehavior: {
              targetOriginId: "webOrigin",
              viewerProtocolPolicy: "redirect-to-https",
              cachePolicyId: "apiCache",
            },
          },
        },
      });

      template.resourceCountIs("AWS::CloudFront::CachePolicy", 1);
      template.resourceCountIs("AWS::CloudFront::Distribution", 1);
    });

    test("references a synthesized OriginRequestPolicy by logical name", () => {
      const template = synthWithCloudFront({
        cachePolicies: {},
        originRequestPolicies: {
          allViewerPolicy: {
            headersConfig: { behavior: "allViewer" },
          },
        },
        distributions: {
          myDist: {
            origins: [
              {
                id: "webOrigin",
                domainName: "example.com",
              },
            ],
            defaultBehavior: {
              targetOriginId: "webOrigin",
              viewerProtocolPolicy: "redirect-to-https",
              originRequestPolicyId: "allViewerPolicy",
            },
          },
        },
      });

      template.resourceCountIs("AWS::CloudFront::OriginRequestPolicy", 1);
      template.resourceCountIs("AWS::CloudFront::Distribution", 1);
    });

    test("creates a Distribution with additional behaviors", () => {
      const template = synthWithCloudFront({
        cachePolicies: {},
        originRequestPolicies: {},
        distributions: {
          myDist: {
            origins: [
              { id: "webOrigin", domainName: "example.com" },
            ],
            defaultBehavior: {
              targetOriginId: "webOrigin",
              viewerProtocolPolicy: "redirect-to-https",
            },
            additionalBehaviors: [
              {
                pathPattern: "/api/*",
                targetOriginId: "webOrigin",
                viewerProtocolPolicy: "redirect-to-https",
                compress: true,
              },
            ],
          },
        },
      });

      template.resourceCountIs("AWS::CloudFront::Distribution", 1);
    });

    test("rejects a distribution referencing an unknown origin", () => {
      expect(() =>
        synthWithCloudFront({
          cachePolicies: {},
          originRequestPolicies: {},
          distributions: {
            myDist: {
              origins: [{ id: "webOrigin", domainName: "example.com" }],
              defaultBehavior: {
                targetOriginId: "unknownOrigin",
                viewerProtocolPolicy: "redirect-to-https",
              },
            },
          },
        }),
      ).toThrow('unknown origin "unknownOrigin"');
    });

    test("rejects a distribution referencing an unknown CachePolicy", () => {
      expect(() =>
        synthWithCloudFront({
          cachePolicies: {},
          originRequestPolicies: {},
          distributions: {
            myDist: {
              origins: [{ id: "webOrigin", domainName: "example.com" }],
              defaultBehavior: {
                targetOriginId: "webOrigin",
                viewerProtocolPolicy: "redirect-to-https",
                cachePolicyId: "nonExistent",
              },
            },
          },
        }),
      ).toThrow('unknown CachePolicy "nonExistent"');
    });
  });

  describe("yamlcdk native config via synthServiceConfig", () => {
    test("no CloudFront resources when cdn is not configured", () => {
      const { template } = synthServiceConfig({});
      template.resourceCountIs("AWS::CloudFront::Distribution", 0);
      template.resourceCountIs("AWS::CloudFront::CachePolicy", 0);
      template.resourceCountIs("AWS::CloudFront::OriginRequestPolicy", 0);
    });
  });
});
