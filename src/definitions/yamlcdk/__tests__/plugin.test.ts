import { describe, expect, test } from "vitest";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { DomainConfigs } from "../../../compiler/plugins/index.js";
import {
  APIS_CONFIG,
} from "../../../domains/apis/model.js";
import {
  DYNAMODB_CONFIG,
} from "../../../domains/dynamodb/model.js";
import {
  S3_CONFIG,
} from "../../../domains/s3/model.js";
import {
  SNS_CONFIG,
} from "../../../domains/sns/model.js";
import {
  SQS_CONFIG,
} from "../../../domains/sqs/model.js";
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

  test("load resolves ${file(...):...} values before schema validation", () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "yamlcdk-file-vars-"));
    const configPath = path.join(dir, "yamlcdk.yml");

    fs.writeFileSync(
      configPath,
      `
service: demo
provider:
  region: \${file(./global.yml):config.region}
functions:
  hello:
    handler: src/hello.handler
    build:
      mode: none
`,
      "utf8",
    );

    fs.writeFileSync(
      path.join(dir, "global.yml"),
      `
config:
  region: ca-central-1
`,
      "utf8",
    );

    const model = yamlcdkDefinitionPlugin.load(configPath);
    expect(model.provider.region).toBe("ca-central-1");
  });

  test("load throws when required ${file(...):...} values are missing", () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "yamlcdk-file-vars-missing-"));
    const configPath = path.join(dir, "yamlcdk.yml");

    fs.writeFileSync(
      configPath,
      `
service: demo
provider:
  region: \${file(./missing.yml):config.region}
functions:
  hello:
    handler: src/hello.handler
    build:
      mode: none
`,
      "utf8",
    );

    expect(() => yamlcdkDefinitionPlugin.load(configPath)).toThrow(
      /Unable to resolve variable/,
    );
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
              removalPolicy: "RETAIN",
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
    expect(dynamoConfig.tables.users.removalPolicy).toBe("RETAIN");
    expect(dynamoConfig.tables.users.stream).toBe("NEW_AND_OLD_IMAGES");
  });

  test("populates SQS and expanded SNS domain configs", () => {
    const normalized = normalizeConfig(
      validateServiceConfig({
        service: "demo",
        messaging: {
          sqs: { jobs: { visibilityTimeout: 30 } },
          sns: {
            events: {
              topicName: "events-topic.fifo",
              displayName: "Events",
              fifoTopic: true,
              contentBasedDeduplication: true,
              fifoThroughputScope: "MessageGroup",
              kmsMasterKeyId: "alias/aws/sns",
              signatureVersion: "2",
              tracingConfig: "Active",
              archivePolicy: {
                MessageRetentionPeriod: "7",
              },
              dataProtectionPolicy: {
                Name: "events-policy",
              },
              deliveryStatusLogging: [
                {
                  protocol: "lambda",
                  successFeedbackSampleRate: "100",
                },
              ],
              tags: {
                Team: "platform",
              },
              subscriptions: [{ type: "sqs", target: "jobs" }],
            },
          },
        },
        functions: {},
      }),
    );
    const model = adaptConfig(normalized);

    expect(model.domainConfigs.require(SQS_CONFIG).queues.jobs.visibilityTimeout).toBe(
      30,
    );
    expect(model.domainConfigs.require(SNS_CONFIG).topics.events).toEqual(
      expect.objectContaining({
        topicName: "events-topic.fifo",
        displayName: "Events",
        fifoTopic: true,
        contentBasedDeduplication: true,
        fifoThroughputScope: "MessageGroup",
        kmsMasterKeyId: "alias/aws/sns",
        signatureVersion: "2",
        tracingConfig: "Active",
        archivePolicy: {
          MessageRetentionPeriod: "7",
        },
        dataProtectionPolicy: {
          Name: "events-policy",
        },
        deliveryStatusLogging: [
          {
            protocol: "lambda",
            successFeedbackSampleRate: "100",
          },
        ],
        tags: {
          Team: "platform",
        },
      }),
    );
    expect(model.domainConfigs.require(SNS_CONFIG).topics.events.subscriptions).toEqual([
      {
        type: "sqs",
        target: "jobs",
      },
    ]);
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

  test("normalizes managed references in events and IAM resources", () => {
    const normalized = normalizeConfig(
      validateServiceConfig({
        service: "demo",
        functions: {
          fn: {
            handler: "src/fn.handler",
            iam: ["readUsers"],
            events: {
              sqs: [{ queue: "ref:jobs" }],
              s3: [{ bucket: "ref:uploads", events: ["s3:ObjectCreated:*"] }],
            },
          },
        },
        iam: {
          statements: {
            readUsers: {
              actions: ["dynamodb:GetItem"],
              resources: ["ref:users"],
            },
          },
        },
      }),
    );
    const model = adaptConfig(normalized);

    const sqsEvent = model.functions.fn.events.find((event) => event.type === "sqs");
    const s3Event = model.functions.fn.events.find((event) => event.type === "s3");

    expect(sqsEvent).toBeDefined();
    if (sqsEvent?.type === "sqs") {
      expect(sqsEvent.queue).toBe("jobs");
    }

    expect(s3Event).toBeDefined();
    if (s3Event?.type === "s3") {
      expect(s3Event.bucket).toBe("uploads");
    }

    expect(model.iam.statements.readUsers.resources).toEqual(["users"]);
  });

  test("accepts bare and ref-prefixed managed references equivalently", () => {
    const createModel = (prefix: "" | "ref:") =>
      adaptConfig(
        normalizeConfig(
          validateServiceConfig({
            service: "demo",
            functions: {
              fn: {
                handler: "src/fn.handler",
                events: {
                  sqs: [{ queue: `${prefix}jobs`, batchSize: 5 }],
                  s3: [{ bucket: `${prefix}uploads`, events: ["s3:ObjectCreated:*"] }],
                  sns: [{ topic: `${prefix}alerts` }],
                  dynamodb: [{ table: `${prefix}users`, startingPosition: "LATEST" }],
                },
                iam: ["readUsers"],
              },
            },
            iam: {
              statements: {
                readUsers: {
                  actions: ["dynamodb:GetItem"],
                  resources: [`${prefix}users`],
                },
              },
            },
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
          }),
        ),
      );

    const bareModel = createModel("");
    const refModel = createModel("ref:");

    expect(bareModel.functions.fn.events).toEqual(refModel.functions.fn.events);
    expect(bareModel.functions.fn.events).toEqual(
      expect.arrayContaining([
        { type: "sqs", queue: "jobs", batchSize: 5 },
        { type: "s3", bucket: "uploads", events: ["s3:ObjectCreated:*"] },
        { type: "sns", topic: "alerts" },
        {
          type: "dynamodb-stream",
          table: "users",
          batchSize: undefined,
          startingPosition: "LATEST",
        },
      ]),
    );
    expect(bareModel.iam.statements.readUsers.resources).toEqual(["users"]);
    expect(refModel.iam.statements.readUsers.resources).toEqual(["users"]);
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
