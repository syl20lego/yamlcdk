import { Match, Template } from "aws-cdk-lib/assertions";
import { describe, expect, test } from "vitest";
import { functionConfig, synthServiceConfig } from "./helpers.js";
import { buildApp } from "../../stack-builder.js";
import { normalizeConfig } from "../../../config/normalize.js";
import { validateServiceConfig } from "../../../config/schema.js";

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

  test("synthesizes nodejs24.x runtime when configured", () => {
    const { template } = synthServiceConfig({
      functions: {
        hello: functionConfig({
          runtime: "nodejs24.x",
        }),
      },
    });

    template.hasResourceProperties(
      "AWS::Lambda::Function",
      Match.objectLike({
        Runtime: "nodejs24.x",
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

  test("resolves bare managed resource names in IAM statement resources", () => {
    const { template } = synthServiceConfig({
      functions: {
        reader: functionConfig({
          iam: ["readUsers"],
        }),
      },
      storage: {
        dynamodb: {
          users: {
            partitionKey: { name: "pk", type: "string" },
          },
        },
      },
      iam: {
        statements: {
          readUsers: {
            actions: ["dynamodb:GetItem"],
            resources: ["users"],
          },
        },
      },
    });

    const policies = template.findResources("AWS::IAM::Policy") as Record<
      string,
      {
        Properties?: {
          PolicyDocument?: {
            Statement?: Array<{ Resource?: unknown }>;
          };
        };
      }
    >;
    const policy = Object.values(policies)[0];
    const firstStatement = policy?.Properties?.PolicyDocument?.Statement?.[0];

    expect(firstStatement).toBeDefined();
    expect(JSON.stringify(firstStatement?.Resource)).toContain("Fn::GetAtt");
  });

  test("uses stub builds for inline code when stubBuild is enabled", () => {
    const raw = validateServiceConfig({
      service: "demo",
      functions: {
        hello: functionConfig(),
      },
    });
    const config = normalizeConfig(raw);
    const { stack } = buildApp(config, { stubBuild: true });
    const template = Template.fromStack(stack);

    template.resourceCountIs("AWS::Lambda::Function", 1);
    template.hasResourceProperties(
      "AWS::Lambda::Function",
      Match.objectLike({ Handler: "index.handler" }),
    );
  });

  test("describeValidation returns semantic properties for functions", () => {
    const { stack } = synthServiceConfig({
      functions: {
        hello: functionConfig({
          timeout: 20,
          memorySize: 1024,
          events: {
            http: [{ method: "POST", path: "/submit" }],
          },
        }),
      },
    });

    expect(stack.validationContributions.length).toBeGreaterThan(0);
    const contrib = stack.validationContributions.find(
      (c) => c.description?.includes("hello"),
    );
    expect(contrib).toBeDefined();
    expect(contrib?.properties).toMatchObject({
      memory: 1024,
      timeout: 20,
    });
    const events = contrib?.properties?.linkedEvents as Array<Record<string, unknown>>;
    expect(events).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ type: "http", method: "POST", path: "/submit" }),
      ]),
    );
  });

  test("synthesizes Ref intrinsic environment values into CloudFormation Ref tokens", () => {
    const { template } = synthServiceConfig({
      functions: {
        worker: functionConfig({
          environment: {
            QUEUE_URL: { Ref: "JobsQueue" },
          },
        }),
      },
      messaging: {
        sqs: { JobsQueue: { visibilityTimeout: 30 } },
      },
    });

    template.hasResourceProperties(
      "AWS::Lambda::Function",
      Match.objectLike({
        Environment: {
          Variables: {
            QUEUE_URL: Match.objectLike({ Ref: Match.anyValue() }),
          },
        },
      }),
    );
  });

  test("synthesizes Fn::GetAtt intrinsic environment values", () => {
    const { template } = synthServiceConfig({
      functions: {
        worker: functionConfig({
          environment: {
            TABLE_ARN: { "Fn::GetAtt": ["OrdersTable", "Arn"] },
          },
        }),
      },
      storage: {
        dynamodb: {
          OrdersTable: {
            partitionKey: { name: "pk", type: "string" },
          },
        },
      },
    });

    template.hasResourceProperties(
      "AWS::Lambda::Function",
      Match.objectLike({
        Environment: {
          Variables: {
            TABLE_ARN: Match.objectLike({ "Fn::GetAtt": Match.anyValue() }),
          },
        },
      }),
    );
  });

  test("synthesizes Fn::Sub intrinsic environment values", () => {
    const { template } = synthServiceConfig({
      functions: {
        worker: functionConfig({
          environment: {
            COMPOSED: { "Fn::Sub": "arn:aws:sqs:${AWS::Region}:${AWS::AccountId}:my-queue" },
          },
        }),
      },
    });

    template.hasResourceProperties(
      "AWS::Lambda::Function",
      Match.objectLike({
        Environment: {
          Variables: {
            COMPOSED: Match.objectLike({ "Fn::Sub": Match.anyValue() }),
          },
        },
      }),
    );
  });

  test("synthesizes Fn::Join intrinsic environment values", () => {
    const { template } = synthServiceConfig({
      functions: {
        worker: functionConfig({
          environment: {
            NAME: { "Fn::Join": ["-", ["prefix", { Ref: "AWS::StackName" }]] },
          },
        }),
      },
    });

    template.hasResourceProperties(
      "AWS::Lambda::Function",
      Match.objectLike({
        Environment: {
          Variables: {
            NAME: Match.objectLike({ "Fn::Join": Match.anyValue() }),
          },
        },
      }),
    );
  });
});
