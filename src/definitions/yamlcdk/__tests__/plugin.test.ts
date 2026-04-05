import { describe, expect, test } from "vitest";
import { DomainConfigs } from "../../../compiler/plugins/index.js";
import {
  APIS_CONFIG,
  DYNAMODB_CONFIG,
  S3_CONFIG,
  SNS_CONFIG,
  SQS_CONFIG,
} from "../../../compiler/plugins/native-domain-configs.js";
import { normalizeConfig } from "../../../config/normalize.js";
import { validateServiceConfig } from "../../../config/schema.js";
import { adaptConfig, yamlcdkDefinitionPlugin } from "../index.js";

describe("yamlcdk definition plugin", () => {
  test("canLoad matches yml and yaml extensions", () => {
    expect(yamlcdkDefinitionPlugin.canLoad("yamlcdk.yml")).toBe(true);
    expect(yamlcdkDefinitionPlugin.canLoad("config.yaml")).toBe(true);
    expect(yamlcdkDefinitionPlugin.canLoad("config.json")).toBe(false);
    expect(yamlcdkDefinitionPlugin.canLoad("serverless.yml")).toBe(false);
  });

  test("generateStarter returns valid YAML content", () => {
    const content = yamlcdkDefinitionPlugin.generateStarter!();

    expect(content).toContain("service:");
    expect(content).toContain("provider:");
    expect(content).toContain("functions:");
    expect(content).toContain("storage:");
  });

  test("formatName is yamlcdk", () => {
    expect(yamlcdkDefinitionPlugin.formatName).toBe("yamlcdk");
  });
});

describe("adaptConfig", () => {
  test("converts NormalizedServiceConfig to ServiceModel", () => {
    const normalized = normalizeConfig(
      validateServiceConfig({
        service: "demo",
        provider: { stage: "prod", region: "eu-west-1" },
        functions: {},
      }),
    );
    const model = adaptConfig(normalized);

    expect(model.service).toBe("demo");
    expect(model.stackName).toBe("demo-prod");
    expect(model.provider.region).toBe("eu-west-1");
    expect(model.provider.stage).toBe("prod");
    expect(model.domainConfigs).toBeInstanceOf(DomainConfigs);
  });

  test("populates S3 domain config from storage.s3", () => {
    const normalized = normalizeConfig(
      validateServiceConfig({
        service: "demo",
        provider: {
          s3: { cleanupRoleArn: "arn:aws:iam::123456789012:role/Cleanup" },
        },
        storage: {
          s3: { uploads: { versioned: true, autoDeleteObjects: true } },
        },
        functions: {},
      }),
    );
    const model = adaptConfig(normalized);
    const s3Config = model.domainConfigs.require(S3_CONFIG);

    expect(s3Config.buckets.uploads.versioned).toBe(true);
    expect(s3Config.buckets.uploads.autoDeleteObjects).toBe(true);
    expect(s3Config.cleanupRoleArn).toBe(
      "arn:aws:iam::123456789012:role/Cleanup",
    );
  });

  test("populates DynamoDB domain config", () => {
    const normalized = normalizeConfig(
      validateServiceConfig({
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
      }),
    );
    const model = adaptConfig(normalized);
    const dynamoConfig = model.domainConfigs.require(DYNAMODB_CONFIG);

    expect(dynamoConfig.tables.users.partitionKey.name).toBe("pk");
    expect(dynamoConfig.tables.users.stream).toBe("NEW_AND_OLD_IMAGES");
  });

  test("populates SQS and SNS domain configs", () => {
    const normalized = normalizeConfig(
      validateServiceConfig({
        service: "demo",
        messaging: {
          sqs: { jobs: { visibilityTimeout: 30 } },
          sns: { events: { subscriptions: [{ type: "sqs", target: "jobs" }] } },
        },
        functions: {},
      }),
    );
    const model = adaptConfig(normalized);

    expect(model.domainConfigs.require(SQS_CONFIG).queues.jobs.visibilityTimeout).toBe(
      30,
    );
    expect(
      model.domainConfigs.require(SNS_CONFIG).topics.events.subscriptions,
    ).toHaveLength(1);
  });

  test("populates APIs domain config from restApi settings", () => {
    const normalized = normalizeConfig(
      validateServiceConfig({
        service: "demo",
        provider: {
          restApi: {
            cloudWatchRoleArn: "arn:aws:iam::123456789012:role/CWRole",
          },
        },
        functions: {},
      }),
    );
    const model = adaptConfig(normalized);
    const apisConfig = model.domainConfigs.require(APIS_CONFIG);

    expect(apisConfig.restApi?.cloudWatchRoleArn).toBe(
      "arn:aws:iam::123456789012:role/CWRole",
    );
  });

  test("flattens function events into EventDeclaration array", () => {
    const normalized = normalizeConfig(
      validateServiceConfig({
        service: "demo",
        functions: {
          handler: {
            handler: "src/handler.handler",
            events: {
              http: [{ method: "GET", path: "/a" }],
              rest: [{ method: "POST", path: "/b" }],
              sqs: [{ queue: "ref:q", batchSize: 5 }],
              eventbridge: [{ schedule: "rate(1 hour)" }],
            },
          },
        },
        messaging: { sqs: { q: {} } },
      }),
    );
    const model = adaptConfig(normalized);
    const events = model.functions.handler.events;

    expect(events).toHaveLength(4);
    expect(events.map((event) => event.type).sort()).toEqual([
      "eventbridge",
      "http",
      "rest",
      "sqs",
    ]);
  });

  test("applies function URL defaults and carries explicit CORS config", () => {
    const normalized = normalizeConfig(
      validateServiceConfig({
        service: "demo",
        functions: {
          fn: {
            handler: "src/fn.handler",
            url: {
              cors: {
                allowedMethods: ["GET"],
                allowOrigins: ["https://example.com"],
              },
            },
          },
        },
      }),
    );
    const model = adaptConfig(normalized);

    expect(model.functions.fn.url).toEqual({
      authType: "AWS_IAM",
      invokeMode: "BUFFERED",
      cors: {
        allowedMethods: ["GET"],
        allowOrigins: ["https://example.com"],
      },
    });
  });

  test("resolves REST apiKeyRequired from global provider setting", () => {
    const normalized = normalizeConfig(
      validateServiceConfig({
        service: "demo",
        provider: { restApi: { apiKeyRequired: true } },
        functions: {
          fn: {
            handler: "src/fn.handler",
            events: { rest: [{ method: "GET", path: "/x" }] },
          },
        },
      }),
    );
    const model = adaptConfig(normalized);
    const restEvent = model.functions.fn.events.find(
      (event) => event.type === "rest",
    );

    expect(restEvent).toBeDefined();
    if (restEvent?.type === "rest") {
      expect(restEvent.apiKeyRequired).toBe(true);
    }
  });
});
