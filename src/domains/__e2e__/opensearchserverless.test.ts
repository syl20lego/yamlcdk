import { Match } from "aws-cdk-lib/assertions";
import { describe, expect, test } from "vitest";
import { synthServiceConfig } from "./helpers.js";

describe("opensearchserverless domain e2e", () => {
  test("creates a collection and auto-generates required policies", () => {
    const { template } = synthServiceConfig({
      storage: {
        opensearch: {
          autoCreatePolicies: true,
          collections: {
            search: {
              type: "SEARCH",
            },
          },
        },
      },
    });

    template.resourceCountIs("AWS::OpenSearchServerless::Collection", 1);
    template.resourceCountIs("AWS::OpenSearchServerless::SecurityPolicy", 1);
    template.resourceCountIs("AWS::OpenSearchServerless::AccessPolicy", 1);
    template.hasResourceProperties(
      "AWS::OpenSearchServerless::Collection",
      Match.objectLike({
        Name: "search-dev",
        Type: "SEARCH",
      }),
    );
  });

  test("creates explicitly configured OpenSearch Serverless resources", () => {
    const { template } = synthServiceConfig({
      storage: {
        opensearch: {
          autoCreatePolicies: false,
          collections: {
            search: {
              name: "search-dev",
              type: "SEARCH",
            },
          },
          securityPolicies: {
            encryptionPolicy: {
              name: "search-encryption",
              type: "encryption",
              policy:
                '[{"Rules":[{"ResourceType":"collection","Resource":["collection/search-dev"]}],"AWSOwnedKey":true}]',
            },
          },
          accessPolicies: {
            dataPolicy: {
              name: "search-data",
              type: "data",
              policy:
                '[{"Rules":[{"ResourceType":"collection","Resource":["collection/search-dev"],"Permission":["aoss:*"]}],"Principal":["arn:aws:iam::123456789012:root"]}]',
            },
          },
          vpcEndpoints: {
            endpoint: {
              name: "search-endpoint",
              vpcId: "vpc-12345678",
              subnetIds: ["subnet-11111111"],
              securityGroupIds: ["sg-12345678"],
            },
          },
        },
      },
    });

    template.resourceCountIs("AWS::OpenSearchServerless::Collection", 1);
    template.resourceCountIs("AWS::OpenSearchServerless::SecurityPolicy", 1);
    template.resourceCountIs("AWS::OpenSearchServerless::AccessPolicy", 1);
    template.resourceCountIs("AWS::OpenSearchServerless::VpcEndpoint", 1);
  });

  test("creates only one encryption policy when an explicit matching policy exists", () => {
    const { template } = synthServiceConfig({
      storage: {
        opensearch: {
          autoCreatePolicies: true,
          collections: {
            search: {
              name: "search-dev",
              type: "SEARCH",
            },
          },
          securityPolicies: {
            encryptionPolicy: {
              name: "search-encryption",
              type: "encryption",
              policy:
                '[{"Rules":[{"ResourceType":"collection","Resource":["collection/search-dev"]}],"AWSOwnedKey":true}]',
            },
          },
        },
      },
    });

    template.resourceCountIs("AWS::OpenSearchServerless::SecurityPolicy", 1);
  });
});
