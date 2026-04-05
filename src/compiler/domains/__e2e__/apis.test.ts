import { Match } from "aws-cdk-lib/assertions";
import { describe, expect, test } from "vitest";
import { functionConfig, synthServiceConfig } from "./helpers.js";

describe("apis domain e2e", () => {
  test("creates an HTTP API route for an http event", () => {
    const { template } = synthServiceConfig({
      functions: {
        hello: functionConfig({
          events: {
            http: [{ method: "GET", path: "/hello" }],
          },
        }),
      },
    });

    template.hasOutput("HttpApiUrl", {});
    template.resourceCountIs("AWS::ApiGatewayV2::Route", 1);
  });

  test("keeps REST api keys disabled when no optional setting is configured", () => {
    const { template } = synthServiceConfig({
      functions: {
        hello: functionConfig({
          events: {
            rest: [{ method: "GET", path: "/hello" }],
          },
        }),
      },
    });

    template.hasOutput("RestApiUrl", {});
    template.hasResourceProperties(
      "AWS::ApiGateway::Method",
      Match.objectLike({
        ApiKeyRequired: false,
      }),
    );
  });

  test("requires REST api keys when the provider-level option is configured", () => {
    const { template } = synthServiceConfig({
      provider: {
        restApi: {
          apiKeyRequired: true,
        },
      },
      functions: {
        hello: functionConfig({
          events: {
            rest: [{ method: "GET", path: "/hello" }],
          },
        }),
      },
    });

    template.hasResourceProperties(
      "AWS::ApiGateway::Method",
      Match.objectLike({
        ApiKeyRequired: true,
      }),
    );
  });

  test("requires REST api keys when the function-level option is configured", () => {
    const { template } = synthServiceConfig({
      functions: {
        hello: functionConfig({
          restApi: {
            apiKeyRequired: true,
          },
          events: {
            rest: [{ method: "GET", path: "/hello" }],
          },
        }),
      },
    });

    template.hasResourceProperties(
      "AWS::ApiGateway::Method",
      Match.objectLike({
        ApiKeyRequired: true,
      }),
    );
  });

  test("creates an ApiGateway account resource when cloudWatchRoleArn is configured", () => {
    const { template } = synthServiceConfig({
      provider: {
        restApi: {
          cloudWatchRoleArn:
            "arn:aws:iam::123456789012:role/MyApiGatewayCloudWatchRole",
        },
      },
      functions: {
        hello: functionConfig({
          events: {
            rest: [{ method: "GET", path: "/hello" }],
          },
        }),
      },
    });

    template.hasResourceProperties(
      "AWS::ApiGateway::Account",
      Match.objectLike({
        CloudWatchRoleArn:
          "arn:aws:iam::123456789012:role/MyApiGatewayCloudWatchRole",
      }),
    );
    expect(template.toJSON().Outputs?.HttpApiUrl).toBeUndefined();
    template.hasOutput("RestApiUrl", {});
  });
});
