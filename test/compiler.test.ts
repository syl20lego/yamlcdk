import { describe, expect, test } from "vitest";
import { buildApp } from "../src/compiler/stack-builder.js";
import { normalizeConfig } from "../src/config/normalize.js";
import { validateServiceConfig } from "../src/config/schema.js";

describe("compiler", () => {
  test("synthesizes stack with core resources", () => {
    const config = normalizeConfig(
      validateServiceConfig({
        service: "demo",
        functions: {
          hello: {
            handler: "src/hello.handler",
            build: {
              mode: "external",
              command: "node -e \"require('fs').mkdirSync('src',{recursive:true});require('fs').writeFileSync('src/hello.js','exports.handler=async()=>({statusCode:200,body:\\\"ok\\\"});')\"",
              handler: "src/hello.handler",
            },
            events: {
              http: [{ method: "GET", path: "/hello" }],
              rest: [{ method: "GET", path: "/hello-rest" }],
            },
          },
        },
        storage: {
          s3: { uploads: { autoDeleteObjects: true } },
          dynamodb: {
            users: { partitionKey: { name: "pk", type: "string" } },
          },
        },
        provider: {
          s3: {
            cleanupRoleArn: "arn:aws:iam::123456789012:role/MyS3CleanupRole",
          },
        },
        messaging: {
          sqs: { jobs: {} },
          sns: { events: {} },
        },
      }),
    );
    const { app } = buildApp(config);
    const assembly = app.synth();
    const stackArtifact = assembly.getStackArtifact(config.stackName);
    expect(stackArtifact).toBeTruthy();
    expect(Object.keys(stackArtifact.template.Resources).length).toBeGreaterThan(0);
    expect(stackArtifact.template.Outputs).toHaveProperty("HttpApiUrl");
    expect(stackArtifact.template.Outputs).toHaveProperty("RestApiUrl");
  });

  test("keeps S3 bucket retained by default when autoDeleteObjects is not enabled", () => {
    const config = normalizeConfig(
      validateServiceConfig({
        service: "demo",
        storage: {
          s3: { uploads: {} },
        },
        functions: {},
      }),
    );
    const { app } = buildApp(config);
    const assembly = app.synth();
    const stackArtifact = assembly.getStackArtifact(config.stackName);
    const resources = stackArtifact.template.Resources as Record<
      string,
      { Type?: string; DeletionPolicy?: string }
    >;
    const bucket = Object.values(resources).find(
      (resource) => resource.Type === "AWS::S3::Bucket",
    );
    expect(bucket?.DeletionPolicy).toBe("Retain");
  });

  test("enables S3 auto-delete only when explicitly configured and cleanup role is provided", () => {
    const config = normalizeConfig(
      validateServiceConfig({
        service: "demo",
        provider: {
          s3: {
            cleanupRoleArn: "arn:aws:iam::123456789012:role/MyS3CleanupRole",
          },
        },
        storage: {
          s3: { uploads: { autoDeleteObjects: true } },
        },
        functions: {},
      }),
    );
    const { app } = buildApp(config);
    const assembly = app.synth();
    const stackArtifact = assembly.getStackArtifact(config.stackName);
    const resources = stackArtifact.template.Resources as Record<
      string,
      { Type?: string; DeletionPolicy?: string }
    >;
    const bucket = Object.values(resources).find(
      (resource) => resource.Type === "AWS::S3::Bucket",
    );
    expect(bucket?.DeletionPolicy).toBe("Delete");
  });

  test("rejects S3 auto-delete when provider.s3.cleanupRoleArn is missing", () => {
    const config = normalizeConfig(
      validateServiceConfig({
        service: "demo",
        storage: {
          s3: { uploads: { autoDeleteObjects: true } },
        },
        functions: {},
      }),
    );
    expect(() => buildApp(config)).toThrow(
      "S3 auto-delete requires provider.s3.cleanupRoleArn",
    );
  });

  test("requires API key for all REST routes when provider-level setting is enabled", () => {
    const config = normalizeConfig(
      validateServiceConfig({
        service: "demo",
        provider: {
          restApi: {
            apiKeyRequired: true,
          },
        },
        functions: {
          hello: {
            handler: "src/hello.handler",
            build: {
              mode: "external",
              command: "node -e \"require('fs').mkdirSync('src',{recursive:true});require('fs').writeFileSync('src/hello.js','exports.handler=async()=>({statusCode:200,body:\\\"ok\\\"});')\"",
              handler: "src/hello.handler",
            },
            events: {
              rest: [{ method: "GET", path: "/hello" }],
            },
          },
        },
      }),
    );

    const { app } = buildApp(config);
    const assembly = app.synth();
    const stackArtifact = assembly.getStackArtifact(config.stackName);
    const resources = stackArtifact.template.Resources as Record<string, { Type?: string; Properties?: { ApiKeyRequired?: boolean } }>;
    const restMethods = Object.values(resources).filter(
      (resource) => resource.Type === "AWS::ApiGateway::Method",
    );
    expect(restMethods.length).toBeGreaterThan(0);
    expect(restMethods.every((method) => method.Properties?.ApiKeyRequired === true)).toBe(true);
  });

  test("applies function-level REST API key when no provider-level setting exists", () => {
    const config = normalizeConfig(
      validateServiceConfig({
        service: "demo",
        functions: {
          hello: {
            handler: "src/hello.handler",
            build: {
              mode: "external",
              command: "node -e \"require('fs').mkdirSync('src',{recursive:true});require('fs').writeFileSync('src/hello.js','exports.handler=async()=>({statusCode:200,body:\\\"ok\\\"});')\"",
              handler: "src/hello.handler",
            },
            restApi: {
              apiKeyRequired: true,
            },
            events: {
              rest: [{ method: "GET", path: "/hello" }],
            },
          },
        },
      }),
    );

    const { app } = buildApp(config);
    const assembly = app.synth();
    const stackArtifact = assembly.getStackArtifact(config.stackName);
    const resources = stackArtifact.template.Resources as Record<string, { Type?: string; Properties?: { ApiKeyRequired?: boolean } }>;
    const restMethods = Object.values(resources).filter(
      (resource) => resource.Type === "AWS::ApiGateway::Method",
    );
    expect(restMethods.length).toBeGreaterThan(0);
    expect(restMethods.every((method) => method.Properties?.ApiKeyRequired === true)).toBe(true);
  });

  test("creates ApiGateway account role resource when provider restApi cloudWatchRoleArn is set", () => {
    const config = normalizeConfig(
      validateServiceConfig({
        service: "demo",
        provider: {
          restApi: {
            cloudWatchRoleArn:
              "arn:aws:iam::123456789012:role/MyApiGatewayCloudWatchRole",
          },
        },
        functions: {
          hello: {
            handler: "src/hello.handler",
            build: {
              mode: "external",
              command: "node -e \"require('fs').mkdirSync('src',{recursive:true});require('fs').writeFileSync('src/hello.js','exports.handler=async()=>({statusCode:200,body:\\\"ok\\\"});')\"",
              handler: "src/hello.handler",
            },
            events: {
              rest: [{ method: "GET", path: "/hello" }],
            },
          },
        },
      }),
    );

    const { app } = buildApp(config);
    const assembly = app.synth();
    const stackArtifact = assembly.getStackArtifact(config.stackName);
    const resources = stackArtifact.template.Resources as Record<
      string,
      { Type?: string; Properties?: { CloudWatchRoleArn?: string } }
    >;
    const accountResources = Object.values(resources).filter(
      (resource) => resource.Type === "AWS::ApiGateway::Account",
    );
    expect(accountResources.length).toBeGreaterThan(0);
    expect(
      accountResources.some(
        (resource) =>
          resource.Properties?.CloudWatchRoleArn ===
          "arn:aws:iam::123456789012:role/MyApiGatewayCloudWatchRole",
      ),
    ).toBe(true);
    expect(
      accountResources.some(
        (resource) =>
          resource.Properties?.CloudWatchRoleArn !== undefined,
      ),
    ).toBe(true);

    const roleResources = Object.values(resources).filter(
      (resource) => resource.Type === "AWS::IAM::Role",
    );
    expect(
      roleResources.some((resource) =>
        JSON.stringify(resource).includes("RestApiCloudWatchRole"),
      ),
    ).toBe(false);
    expect(stackArtifact.template.Outputs).not.toHaveProperty("HttpApiUrl");
    expect(stackArtifact.template.Outputs).toHaveProperty("RestApiUrl");
  });

  test("supports direct role ARN in function iam list", () => {
    const config = normalizeConfig(
      validateServiceConfig({
        service: "demo",
        provider: { account: "123456789012", region: "us-east-1" },
        functions: {
          hello: {
            handler: "src/hello.handler",
            build: {
              mode: "external",
              command: "node -e \"require('fs').mkdirSync('src',{recursive:true});require('fs').writeFileSync('src/hello.js','exports.handler=async()=>({statusCode:200,body:\\\"ok\\\"});')\"",
              handler: "src/hello.handler",
            },
            iam: ["arn:aws:iam::123456789012:role/AldoBasicLambdaRole"],
          },
        },
      }),
    );

    const { app } = buildApp(config);
    const assembly = app.synth();
    const stackArtifact = assembly.getStackArtifact(config.stackName);
    expect(stackArtifact).toBeTruthy();
  });

  test("rejects mixing role ARN and iam statement keys", () => {
    const config = normalizeConfig(
      validateServiceConfig({
        service: "demo",
        provider: { account: "123456789012", region: "us-east-1" },
        functions: {
          hello: {
            handler: "src/hello.handler",
            build: {
              mode: "external",
              command: "node -e \"require('fs').mkdirSync('src',{recursive:true});require('fs').writeFileSync('src/hello.js','exports.handler=async()=>({statusCode:200,body:\\\"ok\\\"});')\"",
              handler: "src/hello.handler",
            },
            iam: [
              "arn:aws:iam::123456789012:role/AldoBasicLambdaRole",
              "readUsers",
            ],
          },
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
    );

    expect(() => buildApp(config)).toThrow(
      "mixes a role ARN with iam statement references",
    );
  });

  test("applies custom deployment synthesizer settings", () => {
    const config = normalizeConfig(
      validateServiceConfig({
        service: "demo",
        provider: {
          account: "123456789012",
          region: "us-east-1",
          deployment: {
            fileAssetsBucketName: "custom-assets-bucket",
            requireBootstrap: false,
          },
        },
        functions: {
          hello: {
            handler: "src/hello.handler",
            build: {
              mode: "external",
              command: "node -e \"require('fs').mkdirSync('src',{recursive:true});require('fs').writeFileSync('src/hello.js','exports.handler=async()=>({statusCode:200,body:\\\"ok\\\"});')\"",
              handler: "src/hello.handler",
            },
          },
        },
      }),
    );

    const { app } = buildApp(config);
    const assembly = app.synth();
    const stackArtifact = assembly.getStackArtifact(config.stackName);
    expect(stackArtifact).toBeTruthy();
  });

  test("infers bootstrap rule disabled when deployment overrides are provided", () => {
    const config = normalizeConfig(
      validateServiceConfig({
        service: "demo",
        provider: {
          account: "123456789012",
          region: "us-east-1",
          deployment: {
            fileAssetsBucketName: "custom-assets-bucket",
          },
        },
        functions: {
          hello: {
            handler: "src/hello.handler",
            build: {
              mode: "external",
              command: "node -e \"require('fs').mkdirSync('src',{recursive:true});require('fs').writeFileSync('src/hello.js','exports.handler=async()=>({statusCode:200,body:\\\"ok\\\"});')\"",
              handler: "src/hello.handler",
            },
          },
        },
      }),
    );

    const { app } = buildApp(config);
    const assembly = app.synth();
    const stackArtifact = assembly.getStackArtifact(config.stackName);
    const rules =
      (stackArtifact.template as { Rules?: Record<string, unknown> }).Rules ?? {};
    expect(Object.keys(rules)).toHaveLength(0);
  });

  test("keeps bootstrap rule by default when no deployment overrides exist", () => {
    const config = normalizeConfig(
      validateServiceConfig({
        service: "demo",
        provider: {
          account: "123456789012",
          region: "us-east-1",
        },
        functions: {
          hello: {
            handler: "src/hello.handler",
            build: {
              mode: "external",
              command: "node -e \"require('fs').mkdirSync('src',{recursive:true});require('fs').writeFileSync('src/hello.js','exports.handler=async()=>({statusCode:200,body:\\\"ok\\\"});')\"",
              handler: "src/hello.handler",
            },
          },
        },
      }),
    );

    const { app } = buildApp(config);
    const assembly = app.synth();
    const stackArtifact = assembly.getStackArtifact(config.stackName);
    const rules =
      (stackArtifact.template as { Rules?: Record<string, unknown> }).Rules ?? {};
    expect(Object.keys(rules).length).toBeGreaterThan(0);
  });

  test("infers cli credentials synthesizer when only asset overrides are provided", () => {
    const config = normalizeConfig(
      validateServiceConfig({
        service: "demo",
        provider: {
          account: "123456789012",
          region: "us-east-1",
          deployment: {
            fileAssetsBucketName: "custom-assets-bucket",
          },
        },
        functions: {
          hello: {
            handler: "src/hello.handler",
            build: {
              mode: "external",
              command: "node -e \"require('fs').mkdirSync('src',{recursive:true});require('fs').writeFileSync('src/hello.js','exports.handler=async()=>({statusCode:200,body:\\\"ok\\\"});')\"",
              handler: "src/hello.handler",
            },
          },
        },
      }),
    );

    const { stack } = buildApp(config);
    expect(stack.synthesizer.constructor.name).toBe("CliCredentialsStackSynthesizer");
  });

  test("does not infer cli credentials synthesizer when role overrides are provided", () => {
    const config = normalizeConfig(
      validateServiceConfig({
        service: "demo",
        provider: {
          account: "123456789012",
          region: "us-east-1",
          deployment: {
            fileAssetsBucketName: "custom-assets-bucket",
            deployRoleArn: "arn:aws:iam::123456789012:role/MyDeployRole",
          },
        },
        functions: {
          hello: {
            handler: "src/hello.handler",
            build: {
              mode: "external",
              command: "node -e \"require('fs').mkdirSync('src',{recursive:true});require('fs').writeFileSync('src/hello.js','exports.handler=async()=>({statusCode:200,body:\\\"ok\\\"});')\"",
              handler: "src/hello.handler",
            },
          },
        },
      }),
    );

    const { stack } = buildApp(config);
    expect(stack.synthesizer.constructor.name).toBe("DefaultStackSynthesizer");
  });

  test("rejects explicit cli credentials with role overrides", () => {
    const config = normalizeConfig(
      validateServiceConfig({
        service: "demo",
        provider: {
          account: "123456789012",
          region: "us-east-1",
          deployment: {
            useCliCredentials: true,
            deployRoleArn: "arn:aws:iam::123456789012:role/MyDeployRole",
          },
        },
        functions: {
          hello: {
            handler: "src/hello.handler",
            build: {
              mode: "external",
              command: "node -e \"require('fs').mkdirSync('src',{recursive:true});require('fs').writeFileSync('src/hello.js','exports.handler=async()=>({statusCode:200,body:\\\"ok\\\"});')\"",
              handler: "src/hello.handler",
            },
          },
        },
      }),
    );

    expect(() => buildApp(config)).toThrow(
      "cannot be combined with deploy/cloudformation role overrides",
    );
  });

  test("rejects cloudFormationServiceRoleArn with deployment role overrides", () => {
    const config = normalizeConfig(
      validateServiceConfig({
        service: "demo",
        provider: {
          account: "123456789012",
          region: "us-east-1",
          deployment: {
            cloudFormationServiceRoleArn:
              "arn:aws:iam::123456789012:role/MyCloudFormationServiceRole",
            deployRoleArn: "arn:aws:iam::123456789012:role/MyDeployRole",
          },
        },
        functions: {
          hello: {
            handler: "src/hello.handler",
            build: {
              mode: "external",
              command: "node -e \"require('fs').mkdirSync('src',{recursive:true});require('fs').writeFileSync('src/hello.js','exports.handler=async()=>({statusCode:200,body:\\\"ok\\\"});')\"",
              handler: "src/hello.handler",
            },
          },
        },
      }),
    );

    expect(() => buildApp(config)).toThrow(
      "cloudFormationServiceRoleArn cannot be combined with deployRoleArn/cloudFormationExecutionRoleArn",
    );
  });

  test("creates S3 event notification when s3 event is configured", () => {
    const config = normalizeConfig(
      validateServiceConfig({
        service: "demo",
        storage: {
          s3: { uploads: {} },
        },
        functions: {
          processor: {
            handler: "src/hello.handler",
            build: {
              mode: "external",
              command: "node -e \"require('fs').mkdirSync('src',{recursive:true});require('fs').writeFileSync('src/hello.js','exports.handler=async()=>({statusCode:200,body:\\\"ok\\\"});')\"",
              handler: "src/hello.handler",
            },
            events: {
              s3: [{ bucket: "ref:uploads", events: ["s3:ObjectCreated:*"] }],
            },
          },
        },
      }),
    );
    const { app } = buildApp(config);
    const assembly = app.synth();
    const stackArtifact = assembly.getStackArtifact(config.stackName);
    const resources = stackArtifact.template.Resources as Record<string, { Type?: string }>;
    const hasS3Notification = Object.values(resources).some(
      (r) => r.Type === "Custom::S3BucketNotifications",
    );
    expect(hasS3Notification).toBe(true);
  });

  test("creates SQS event source mapping when sqs event is configured", () => {
    const config = normalizeConfig(
      validateServiceConfig({
        service: "demo",
        messaging: {
          sqs: { jobs: {} },
        },
        functions: {
          processor: {
            handler: "src/hello.handler",
            build: {
              mode: "external",
              command: "node -e \"require('fs').mkdirSync('src',{recursive:true});require('fs').writeFileSync('src/hello.js','exports.handler=async()=>({statusCode:200,body:\\\"ok\\\"});')\"",
              handler: "src/hello.handler",
            },
            events: {
              sqs: [{ queue: "ref:jobs", batchSize: 5 }],
            },
          },
        },
      }),
    );
    const { app } = buildApp(config);
    const assembly = app.synth();
    const stackArtifact = assembly.getStackArtifact(config.stackName);
    const resources = stackArtifact.template.Resources as Record<string, { Type?: string }>;
    const hasEventSourceMapping = Object.values(resources).some(
      (r) => r.Type === "AWS::Lambda::EventSourceMapping",
    );
    expect(hasEventSourceMapping).toBe(true);
  });

  test("creates SNS subscription when sns event is configured", () => {
    const config = normalizeConfig(
      validateServiceConfig({
        service: "demo",
        messaging: {
          sns: { alerts: {} },
        },
        functions: {
          processor: {
            handler: "src/hello.handler",
            build: {
              mode: "external",
              command: "node -e \"require('fs').mkdirSync('src',{recursive:true});require('fs').writeFileSync('src/hello.js','exports.handler=async()=>({statusCode:200,body:\\\"ok\\\"});')\"",
              handler: "src/hello.handler",
            },
            events: {
              sns: [{ topic: "ref:alerts" }],
            },
          },
        },
      }),
    );
    const { app } = buildApp(config);
    const assembly = app.synth();
    const stackArtifact = assembly.getStackArtifact(config.stackName);
    const resources = stackArtifact.template.Resources as Record<string, { Type?: string }>;
    const hasSnsSubscription = Object.values(resources).some(
      (r) => r.Type === "AWS::SNS::Subscription",
    );
    expect(hasSnsSubscription).toBe(true);
  });

  test("creates SNS to SQS subscription when topic subscriptions are configured", () => {
    const config = normalizeConfig(
      validateServiceConfig({
        service: "demo",
        messaging: {
          sqs: { jobs: {} },
          sns: {
            alerts: {
              subscriptions: [{ type: "sqs", target: "jobs" }],
            },
          },
        },
        functions: {},
      }),
    );
    const { app } = buildApp(config);
    const assembly = app.synth();
    const stackArtifact = assembly.getStackArtifact(config.stackName);
    const resources = stackArtifact.template.Resources as Record<
      string,
      { Type?: string }
    >;
    const hasSnsSubscription = Object.values(resources).some(
      (r) => r.Type === "AWS::SNS::Subscription",
    );
    expect(hasSnsSubscription).toBe(true);
  });

  test("creates DynamoDB stream event source when dynamodb event is configured", () => {
    const config = normalizeConfig(
      validateServiceConfig({
        service: "demo",
        storage: {
          dynamodb: {
            orders: {
              partitionKey: { name: "pk", type: "string" },
              stream: "NEW_AND_OLD_IMAGES",
            },
          },
        },
        functions: {
          processor: {
            handler: "src/hello.handler",
            build: {
              mode: "external",
              command: "node -e \"require('fs').mkdirSync('src',{recursive:true});require('fs').writeFileSync('src/hello.js','exports.handler=async()=>({statusCode:200,body:\\\"ok\\\"});')\"",
              handler: "src/hello.handler",
            },
            events: {
              dynamodb: [{ table: "ref:orders", startingPosition: "LATEST" }],
            },
          },
        },
      }),
    );
    const { app } = buildApp(config);
    const assembly = app.synth();
    const stackArtifact = assembly.getStackArtifact(config.stackName);
    const resources = stackArtifact.template.Resources as Record<string, { Type?: string }>;
    const hasEventSourceMapping = Object.values(resources).some(
      (r) => r.Type === "AWS::Lambda::EventSourceMapping",
    );
    expect(hasEventSourceMapping).toBe(true);
  });

  test("creates EventBridge rule when eventbridge schedule event is configured", () => {
    const config = normalizeConfig(
      validateServiceConfig({
        service: "demo",
        functions: {
          processor: {
            handler: "src/hello.handler",
            build: {
              mode: "external",
              command: "node -e \"require('fs').mkdirSync('src',{recursive:true});require('fs').writeFileSync('src/hello.js','exports.handler=async()=>({statusCode:200,body:\\\"ok\\\"});')\"",
              handler: "src/hello.handler",
            },
            events: {
              eventbridge: [{ schedule: "rate(5 minutes)" }],
            },
          },
        },
      }),
    );
    const { app } = buildApp(config);
    const assembly = app.synth();
    const stackArtifact = assembly.getStackArtifact(config.stackName);
    const resources = stackArtifact.template.Resources as Record<string, { Type?: string }>;
    const hasEventsRule = Object.values(resources).some(
      (r) => r.Type === "AWS::Events::Rule",
    );
    expect(hasEventsRule).toBe(true);
  });

  test("supports eventbridge event pattern", () => {
    const config = normalizeConfig(
      validateServiceConfig({
        service: "demo",
        functions: {
          processor: {
            handler: "src/hello.handler",
            build: {
              mode: "external",
              command: "node -e \"require('fs').mkdirSync('src',{recursive:true});require('fs').writeFileSync('src/hello.js','exports.handler=async()=>({statusCode:200,body:\\\"ok\\\"});')\"",
              handler: "src/hello.handler",
            },
            events: {
              eventbridge: [{ eventPattern: { source: ["orders"] } }],
            },
          },
        },
      }),
    );
    const { app } = buildApp(config);
    const assembly = app.synth();
    const stackArtifact = assembly.getStackArtifact(config.stackName);
    const resources = stackArtifact.template.Resources as Record<string, { Type?: string }>;
    const hasEventsRule = Object.values(resources).some(
      (r) => r.Type === "AWS::Events::Rule",
    );
    expect(hasEventsRule).toBe(true);
  });
});
