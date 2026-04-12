import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { describe, expect, test } from "vitest";
import { normalizeConfig } from "../normalize.js";
import { resolveAwsConfig } from "../../runtime/aws.js";
import { assertTemplateOnlyStack, deployMode } from "../../runtime/cdk.js";
import {
  normalizedServiceConfigSchema,
  validateServiceConfig,
} from "../schema.js";

describe("config validation", () => {
  test("validates and normalizes defaults", () => {
    const raw = validateServiceConfig({
      service: "demo",
      functions: { hello: { handler: "src/handler.hello" } },
    });
    const normalized = normalizeConfig(raw);
    expect(normalized.provider.stage).toBe("dev");
    expect(normalized.provider.region).toBeTypeOf("string");
    expect(normalized.stackName).toBe("demo-dev");
  });

  test("rejects invalid function timeout", () => {
    expect(() =>
      validateServiceConfig({
        service: "demo",
        functions: { hello: { handler: "x", timeout: 9999 } },
      }),
    ).toThrow("Invalid YAML config");
  });

  test("normalized output matches normalized schema", () => {
    const raw = validateServiceConfig({
      service: "demo",
      provider: { stage: "prod", region: "eu-west-1" },
      functions: {},
    });
    const normalized = normalizeConfig(raw);
    expect(() => normalizedServiceConfigSchema.parse(normalized)).not.toThrow();
  });

  test("resolveAwsConfig validates and parses merged config", () => {
    const raw = validateServiceConfig({
      service: "demo",
      provider: { stage: "dev", region: "us-east-1" },
      functions: {},
    });
    const normalized = normalizeConfig(raw);
    const resolved = resolveAwsConfig(normalized, { region: "eu-west-1" });
    expect(resolved.provider.region).toBe("eu-west-1");
    expect(() => normalizedServiceConfigSchema.parse(resolved)).not.toThrow();
  });

  test("resolveAwsConfig rejects empty region override", () => {
    const raw = validateServiceConfig({
      service: "demo",
      provider: { stage: "dev", region: "us-east-1" },
      functions: {},
    });
    const normalized = normalizeConfig(raw);
    expect(() => resolveAwsConfig(normalized, { region: "" })).toThrow();
  });

  test("supports provider deployment overrides", () => {
    const raw = validateServiceConfig({
      service: "demo",
      provider: {
        region: "us-east-1",
        deployment: {
          fileAssetsBucketName: "my-assets",
          cloudFormationExecutionRoleArn:
            "arn:aws:iam::123456789012:role/MyExecRole",
          requireBootstrap: false,
        },
      },
      functions: {},
    });
    const normalized = normalizeConfig(raw);
    expect(normalized.provider.deployment?.fileAssetsBucketName).toBe("my-assets");
    expect(normalized.provider.deployment?.requireBootstrap).toBe(false);
  });

  test("supports function build config", () => {
    const raw = validateServiceConfig({
      service: "demo",
      functions: {
        hello: {
          handler: "src/handlers/hello.handler",
          build: {
            mode: "external",
            command: "npm run build:hello",
            handler: "dist/handlers/hello.handler",
          },
        },
      },
    });
    const normalized = normalizeConfig(raw);
    expect(normalized.functions.hello.build?.mode).toBe("external");
  });

  test("supports function URL config", () => {
    const raw = validateServiceConfig({
      service: "demo",
      functions: {
        hello: {
          handler: "src/handlers/hello.handler",
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
        },
      },
    });
    const normalized = normalizeConfig(raw);

    expect(normalized.functions.hello.url?.authType).toBe("NONE");
    expect(normalized.functions.hello.url?.invokeMode).toBe(
      "RESPONSE_STREAM",
    );
    expect(normalized.functions.hello.url?.cors?.allowedMethods).toEqual([
      "GET",
      "POST",
    ]);
    expect(normalized.functions.hello.url?.cors?.maxAge).toBe(300);
  });

  test("supports REST API event routes and api key settings", () => {
    const raw = validateServiceConfig({
      service: "demo",
      provider: {
        restApi: {
          apiKeyRequired: true,
        },
      },
      functions: {
        hello: {
          handler: "src/handlers/hello.handler",
          events: {
            rest: [{ method: "GET", path: "/hello" }],
          },
          restApi: {
            apiKeyRequired: false,
          },
        },
      },
    });
    const normalized = normalizeConfig(raw);
    expect(normalized.provider.restApi?.apiKeyRequired).toBe(true);
    expect(normalized.functions.hello.events?.rest?.[0]?.path).toBe("/hello");
    expect(normalized.functions.hello.restApi?.apiKeyRequired).toBe(false);
  });

  test("supports provider restApi cloudWatchRoleArn", () => {
    const raw = validateServiceConfig({
      service: "demo",
      provider: {
        restApi: {
          cloudWatchRoleArn:
            "arn:aws:iam::123456789012:role/MyApiGatewayCloudWatchRole",
        },
      },
      functions: {},
    });
    const normalized = normalizeConfig(raw);
    expect(normalized.provider.restApi?.cloudWatchRoleArn).toBe(
      "arn:aws:iam::123456789012:role/MyApiGatewayCloudWatchRole",
    );
  });

  test("supports provider s3 cleanupRoleArn and per-bucket autoDeleteObjects", () => {
    const raw = validateServiceConfig({
      service: "demo",
      provider: {
        s3: {
          cleanupRoleArn: "arn:aws:iam::123456789012:role/MyS3CleanupRole",
        },
      },
      storage: {
        s3: {
          uploads: {
            versioned: true,
            autoDeleteObjects: true,
          },
        },
      },
      functions: {},
    });
    const normalized = normalizeConfig(raw);
    expect(normalized.provider.s3?.cleanupRoleArn).toBe(
      "arn:aws:iam::123456789012:role/MyS3CleanupRole",
    );
    expect(normalized.storage.s3.uploads.autoDeleteObjects).toBe(true);
  });

  test("supports cloudFormationServiceRoleArn in provider deployment", () => {
    const raw = validateServiceConfig({
      service: "demo",
      provider: {
        deployment: {
          cloudFormationServiceRoleArn:
            "arn:aws:iam::123456789012:role/MyCloudFormationServiceRole",
        },
      },
      functions: {},
    });
    const normalized = normalizeConfig(raw);
    expect(normalized.provider.deployment?.cloudFormationServiceRoleArn).toBe(
      "arn:aws:iam::123456789012:role/MyCloudFormationServiceRole",
    );
  });

  test("selects cloudformation service role deploy mode when configured", () => {
    const raw = validateServiceConfig({
      service: "demo",
      provider: {
        deployment: {
          cloudFormationServiceRoleArn:
            "arn:aws:iam::123456789012:role/MyCloudFormationServiceRole",
        },
      },
      functions: {},
    });
    const normalized = normalizeConfig(raw);
    expect(deployMode(normalized)).toBe("cloudformation-service-role");
  });

  test("rejects template-only mode when CDK asset metadata is present", () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "yamlcdk-template-test-"));
    const templatePath = path.join(dir, "template.json");
    fs.writeFileSync(
      templatePath,
      JSON.stringify({ Metadata: { "aws:asset:path": "asset.12345" } }),
      "utf8",
    );
    expect(() => assertTemplateOnlyStack(templatePath)).toThrow(
      "template-only stacks (no CDK assets)",
    );
  });

  test("supports new event types in function schema", () => {
    const raw = validateServiceConfig({
      service: "demo",
      storage: {
        s3: { uploads: {} },
        dynamodb: {
          users: {
            partitionKey: { name: "pk", type: "string" },
            stream: "NEW_AND_OLD_IMAGES",
          },
        },
      },
      messaging: {
        sqs: { jobs: {} },
        sns: { alerts: {} },
      },
      functions: {
        processor: {
          handler: "src/handler.process",
          events: {
            s3: [{ bucket: "ref:uploads", events: ["s3:ObjectCreated:*"] }],
            sqs: [{ queue: "ref:jobs", batchSize: 10 }],
            sns: [{ topic: "ref:alerts" }],
            dynamodb: [
              {
                table: "ref:users",
                batchSize: 100,
                startingPosition: "LATEST",
              },
            ],
            eventbridge: [{ schedule: "rate(5 minutes)" }],
          },
        },
      },
    });
    const normalized = normalizeConfig(raw);
    expect(normalized.functions.processor.events?.s3).toHaveLength(1);
    expect(normalized.functions.processor.events?.sqs).toHaveLength(1);
    expect(normalized.functions.processor.events?.sns).toHaveLength(1);
    expect(normalized.functions.processor.events?.dynamodb).toHaveLength(1);
    expect(normalized.functions.processor.events?.eventbridge).toHaveLength(1);
  });

  test("supports dynamodb stream option", () => {
    const raw = validateServiceConfig({
      service: "demo",
      storage: {
        dynamodb: {
          users: {
            partitionKey: { name: "pk", type: "string" },
            stream: "NEW_AND_OLD_IMAGES",
          },
        },
      },
      functions: {},
    });
    const normalized = normalizeConfig(raw);
    expect(normalized.storage.dynamodb.users.stream).toBe("NEW_AND_OLD_IMAGES");
  });
});
