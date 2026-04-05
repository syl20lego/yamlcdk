import { Match } from "aws-cdk-lib/assertions";
import { describe, expect, test } from "vitest";
import { functionConfig, synthServiceConfig } from "./helpers.js";

describe("functions domain e2e", () => {
  test("creates a lambda function with required settings only", () => {
    const { template } = synthServiceConfig({
      functions: {
        hello: functionConfig(),
      },
    });

    template.resourceCountIs("AWS::Lambda::Function", 1);
  });

  test("applies optional lambda settings when configured", () => {
    const { template } = synthServiceConfig({
      functions: {
        hello: functionConfig({
          runtime: "nodejs22.x",
          timeout: 45,
          memorySize: 512,
          environment: {
            STAGE: "dev",
          },
        }),
      },
    });

    template.hasResourceProperties(
      "AWS::Lambda::Function",
      Match.objectLike({
        Runtime: "nodejs22.x",
        Timeout: 45,
        MemorySize: 512,
        Environment: {
          Variables: {
            STAGE: "dev",
          },
        },
      }),
    );
  });

  test("creates a public lambda function URL with CORS and invoke permissions", () => {
    const { template } = synthServiceConfig({
      functions: {
        hello: functionConfig({
          url: {
            authType: "NONE",
            invokeMode: "RESPONSE_STREAM",
            cors: {
              allowCredentials: true,
              allowHeaders: ["Content-Type"],
              allowedMethods: ["GET", "POST"],
              allowOrigins: ["https://example.com"],
              exposeHeaders: ["X-Trace-Id"],
              maxAge: 300,
            },
          },
        }),
      },
    });

    template.hasResourceProperties(
      "AWS::Lambda::Url",
      Match.objectLike({
        AuthType: "NONE",
        InvokeMode: "RESPONSE_STREAM",
        Cors: Match.objectLike({
          AllowCredentials: true,
          AllowHeaders: ["Content-Type"],
          AllowMethods: ["GET", "POST"],
          AllowOrigins: ["https://example.com"],
          ExposeHeaders: ["X-Trace-Id"],
          MaxAge: 300,
        }),
      }),
    );
    template.resourceCountIs("AWS::Lambda::Permission", 2);
    template.hasOutput("helloFunctionUrl", {});
  });

  test("supports a direct role ARN without creating a managed IAM role", () => {
    const { template } = synthServiceConfig({
      provider: {
        account: "123456789012",
        region: "us-east-1",
      },
      functions: {
        hello: functionConfig({
          iam: ["arn:aws:iam::123456789012:role/ExistingLambdaRole"],
        }),
      },
    });

    template.resourceCountIs("AWS::Lambda::Function", 1);
    template.resourceCountIs("AWS::IAM::Role", 0);
  });

  test("rejects mixing a role ARN with iam statement references", () => {
    expect(() =>
      synthServiceConfig({
        provider: {
          account: "123456789012",
          region: "us-east-1",
        },
        functions: {
          hello: functionConfig({
            iam: [
              "arn:aws:iam::123456789012:role/ExistingLambdaRole",
              "readUsers",
            ],
          }),
        },
        iam: {
          statements: {
            readUsers: {
              actions: ["dynamodb:GetItem"],
              resources: ["*"],
            },
          },
        },
      }),
    ).toThrow("mixes a role ARN with iam statement references");
  });
});
