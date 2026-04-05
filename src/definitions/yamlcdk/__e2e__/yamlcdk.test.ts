import { Match } from "aws-cdk-lib/assertions";
import { describe, expect, test } from "vitest";
import {
    buildDefinitionFromYaml,
    firstResourceOfType,
    resolveDefinitionFromYaml,
    type ResourceDefinition, writeTmpYaml,
} from "../../test-utils/e2e.js";
import {definitionRegistry} from "../../registry.js";

describe("yamlcdk definition e2e", () => {

    describe("definition registry", () => {

        test("resolves yamlcdk files to yamlcdk plugin", () => {
            const yamlcdkPath = writeTmpYaml(
                "service: my-service\nfunctions: {}",
            );
            const plugin = definitionRegistry.resolve(yamlcdkPath);
            expect(plugin.formatName).toBe("yamlcdk");
        });

    });

    describe("service and provider section", () => {
    test("applies provider defaults when the section is omitted", () => {
      const { plugin, model, template } = buildDefinitionFromYaml(`
service: minimal-service
functions:
  hello:
    handler: src/hello.handler
    build:
      mode: none
`);

      expect(plugin.formatName).toBe("yamlcdk");
      expect(model.service).toBe("minimal-service");
      expect(model.provider.stage).toBe("dev");
      expect(model.provider.region).toBe("us-east-1");
      expect(model.stackName).toBe("minimal-service-dev");
      template.resourceCountIs("AWS::Lambda::Function", 1);
    });

    test("loads provider overrides and applies restApi settings to the stack", () => {
      const { plugin, model, template } = buildDefinitionFromYaml(`
service: provider-config
provider:
  stage: prod
  region: eu-west-1
  account: "123456789012"
  profile: platform
  tags:
    team: core
  restApi:
    apiKeyRequired: true
  deployment:
    qualifier: custom-qualifier
functions:
  hello:
    handler: src/hello.handler
    build:
      mode: none
    events:
      rest:
        - method: GET
          path: /hello
`);

      expect(plugin.formatName).toBe("yamlcdk");
      expect(model.provider.region).toBe("eu-west-1");
      expect(model.provider.stage).toBe("prod");
      expect(model.provider.account).toBe("123456789012");
      expect(model.provider.profile).toBe("platform");
      expect(model.provider.tags?.team).toBe("core");
      expect(model.provider.deployment?.qualifier).toBe("custom-qualifier");
      template.hasOutput("RestApiUrl", {});
      template.hasResourceProperties(
        "AWS::ApiGateway::Method",
        Match.objectLike({
          ApiKeyRequired: true,
        }),
      );
    });
  });

  describe("functions section", () => {
    test("creates a lambda with optional runtime, timeout, memory, and environment settings", () => {
      const { model, template } = buildDefinitionFromYaml(`
service: functions-optional
functions:
  worker:
    handler: src/worker.handler
    runtime: nodejs22.x
    timeout: 45
    memorySize: 512
    environment:
      STAGE: test
    build:
      mode: none
`);

      expect(model.functions.worker.runtime).toBe("nodejs22.x");
      expect(model.functions.worker.timeout).toBe(45);
      expect(model.functions.worker.memorySize).toBe(512);
      expect(model.functions.worker.environment?.STAGE).toBe("test");
      template.hasResourceProperties(
        "AWS::Lambda::Function",
        Match.objectLike({
          Runtime: "nodejs22.x",
          Timeout: 45,
          MemorySize: 512,
          Environment: {
            Variables: {
              STAGE: "test",
            },
          },
        }),
      );
    });

    test("creates a lambda function URL from function url config", () => {
      const { model, template } = buildDefinitionFromYaml(`
service: function-url
functions:
  worker:
    handler: src/worker.handler
    build:
      mode: none
    url:
      authType: NONE
      cors:
        allowedMethods:
          - GET
        allowOrigins:
          - https://example.com
`);

      expect(model.functions.worker.url).toEqual({
        authType: "NONE",
        invokeMode: "BUFFERED",
        cors: {
          allowedMethods: ["GET"],
          allowOrigins: ["https://example.com"],
        },
      });
      template.hasResourceProperties(
        "AWS::Lambda::Url",
        Match.objectLike({
          AuthType: "NONE",
        }),
      );
      template.hasOutput("workerFunctionUrl", {});
    });
  });

  describe("storage section", () => {
    test("creates an S3 bucket without optional settings", () => {
      const { template } = buildDefinitionFromYaml(`
service: s3-defaults
storage:
  s3:
    uploads: {}
`);

      const bucket = firstResourceOfType<ResourceDefinition>(
        template,
        "AWS::S3::Bucket",
      );

      expect(bucket?.DeletionPolicy).toBe("Retain");
      expect(bucket?.Properties?.VersioningConfiguration).toBeUndefined();
    });

    test("enables S3 bucket versioning when configured", () => {
      const { template } = buildDefinitionFromYaml(`
service: s3-versioned
storage:
  s3:
    uploads:
      versioned: true
`);

      template.hasResourceProperties(
        "AWS::S3::Bucket",
        Match.objectLike({
          VersioningConfiguration: {
            Status: "Enabled",
          },
        }),
      );
    });

    test("deletes the S3 bucket when autoDeleteObjects and cleanupRoleArn are configured", () => {
      const { template } = buildDefinitionFromYaml(`
service: s3-autodelete
provider:
  s3:
    cleanupRoleArn: arn:aws:iam::123456789012:role/Cleanup
storage:
  s3:
    uploads:
      autoDeleteObjects: true
`);

      const bucket = firstResourceOfType<ResourceDefinition>(
        template,
        "AWS::S3::Bucket",
      );

      expect(bucket?.DeletionPolicy).toBe("Delete");
    });

    test("creates a DynamoDB table with only the required partition key", () => {
      const { template } = buildDefinitionFromYaml(`
service: dynamodb-partition-only
storage:
  dynamodb:
    orders:
      partitionKey:
        name: pk
        type: string
`);

      template.hasResourceProperties(
        "AWS::DynamoDB::Table",
        Match.objectLike({
          KeySchema: Match.arrayWith([
            Match.objectLike({
              AttributeName: "pk",
              KeyType: "HASH",
            }),
          ]),
        }),
      );
    });

    test("adds DynamoDB sort key and stream settings when configured", () => {
      const { template } = buildDefinitionFromYaml(`
service: dynamodb-optionals
storage:
  dynamodb:
    orders:
      partitionKey:
        name: pk
        type: string
      sortKey:
        name: sk
        type: number
      stream: NEW_AND_OLD_IMAGES
`);

      template.hasResourceProperties(
        "AWS::DynamoDB::Table",
        Match.objectLike({
          KeySchema: Match.arrayWith([
            Match.objectLike({
              AttributeName: "pk",
              KeyType: "HASH",
            }),
            Match.objectLike({
              AttributeName: "sk",
              KeyType: "RANGE",
            }),
          ]),
          StreamSpecification: {
            StreamViewType: "NEW_AND_OLD_IMAGES",
          },
        }),
      );
    });
  });

  describe("messaging section", () => {
    test("creates an SQS queue without visibilityTimeout by default", () => {
      const { template } = buildDefinitionFromYaml(`
service: sqs-defaults
messaging:
  sqs:
    jobs: {}
`);

      const queue = firstResourceOfType<ResourceDefinition>(
        template,
        "AWS::SQS::Queue",
      );

      expect(queue?.Properties?.VisibilityTimeout).toBeUndefined();
    });

    test("applies SQS visibilityTimeout when configured", () => {
      const { template } = buildDefinitionFromYaml(`
service: sqs-visibility
messaging:
  sqs:
    jobs:
      visibilityTimeout: 45
`);

      template.hasResourceProperties(
        "AWS::SQS::Queue",
        Match.objectLike({
          VisibilityTimeout: 45,
        }),
      );
    });

    test("creates an SNS to SQS subscription when configured", () => {
      const { template } = buildDefinitionFromYaml(`
service: sns-to-sqs
messaging:
  sqs:
    jobs: {}
  sns:
    alerts:
      subscriptions:
        - type: sqs
          target: jobs
`);

      template.hasResourceProperties(
        "AWS::SNS::Subscription",
        Match.objectLike({
          Protocol: "sqs",
        }),
      );
    });
  });

  describe("events section", () => {
    test("creates an HTTP API route for an http event", () => {
      const { template } = buildDefinitionFromYaml(`
service: demo-api
functions:
  hello:
    handler: src/hello.handler
    build:
      mode: none
    events:
      http:
        - method: GET
          path: /hello
`);

      template.hasOutput("HttpApiUrl", {});
      template.resourceCountIs("AWS::ApiGatewayV2::Route", 1);
    });

    test("creates a REST API method for a rest event", () => {
      const { template } = buildDefinitionFromYaml(`
service: rest-event
functions:
  hello:
    handler: src/hello.handler
    build:
      mode: none
    restApi:
      apiKeyRequired: true
    events:
      rest:
        - method: POST
          path: /items
`);

      template.hasOutput("RestApiUrl", {});
      template.hasResourceProperties(
        "AWS::ApiGateway::Method",
        Match.objectLike({
          ApiKeyRequired: true,
        }),
      );
    });

    test("creates an S3 notification custom resource for an s3 event", () => {
      const { model, template } = buildDefinitionFromYaml(`
service: s3-event
functions:
  processor:
    handler: src/processor.handler
    build:
      mode: none
    events:
      s3:
        - bucket: ref:uploads
          events:
            - s3:ObjectCreated:*
storage:
  s3:
    uploads: {}
`);

      expect(model.functions.processor.events.map((event) => event.type)).toEqual([
        "s3",
      ]);
      template.resourceCountIs("Custom::S3BucketNotifications", 1);
    });

    test("creates an event source mapping for an sqs event", () => {
      const { model, template } = buildDefinitionFromYaml(`
service: sqs-event
functions:
  processor:
    handler: src/processor.handler
    build:
      mode: none
    events:
      sqs:
        - queue: ref:jobs
          batchSize: 5
messaging:
  sqs:
    jobs: {}
`);

      expect(model.functions.processor.events.map((event) => event.type)).toEqual([
        "sqs",
      ]);
      template.hasResourceProperties(
        "AWS::Lambda::EventSourceMapping",
        Match.objectLike({
          BatchSize: 5,
        }),
      );
    });

    test("creates an SNS lambda subscription for an sns event", () => {
      const { model, template } = buildDefinitionFromYaml(`
service: sns-event
functions:
  processor:
    handler: src/processor.handler
    build:
      mode: none
    events:
      sns:
        - topic: ref:alerts
messaging:
  sns:
    alerts: {}
`);

      expect(model.functions.processor.events.map((event) => event.type)).toEqual([
        "sns",
      ]);
      template.hasResourceProperties(
        "AWS::SNS::Subscription",
        Match.objectLike({
          Protocol: "lambda",
        }),
      );
    });

    test("creates a DynamoDB stream mapping for a dynamodb event", () => {
      const { model, template } = buildDefinitionFromYaml(`
service: dynamodb-event
functions:
  processor:
    handler: src/processor.handler
    build:
      mode: none
    events:
      dynamodb:
        - table: ref:orders
          startingPosition: LATEST
storage:
  dynamodb:
    orders:
      partitionKey:
        name: pk
        type: string
      stream: NEW_AND_OLD_IMAGES
`);

      expect(model.functions.processor.events.map((event) => event.type)).toEqual([
        "dynamodb-stream",
      ]);
      template.hasResourceProperties(
        "AWS::Lambda::EventSourceMapping",
        Match.objectLike({
          StartingPosition: "LATEST",
        }),
      );
    });

    test("creates an EventBridge rule for a schedule event", () => {
      const { model, template } = buildDefinitionFromYaml(`
service: eventbridge-schedule
functions:
  processor:
    handler: src/processor.handler
    build:
      mode: none
    events:
      eventbridge:
        - schedule: rate(5 minutes)
`);

      expect(model.functions.processor.events.map((event) => event.type)).toEqual([
        "eventbridge",
      ]);
      template.hasResourceProperties(
        "AWS::Events::Rule",
        Match.objectLike({
          ScheduleExpression: "rate(5 minutes)",
        }),
      );
    });

    test("creates an EventBridge rule for an event pattern event", () => {
      const { model, template } = buildDefinitionFromYaml(`
service: eventbridge-pattern
functions:
  processor:
    handler: src/processor.handler
    build:
      mode: none
    events:
      eventbridge:
        - eventPattern:
            source:
              - orders
`);

      expect(model.functions.processor.events.map((event) => event.type)).toEqual([
        "eventbridge",
      ]);
      template.hasResourceProperties(
        "AWS::Events::Rule",
        Match.objectLike({
          EventPattern: {
            source: ["orders"],
          },
        }),
      );
    });
  });

  describe("iam section", () => {
    test("creates an IAM policy from named statements referenced by a function", () => {
      const { model, template } = buildDefinitionFromYaml(`
service: iam-policy
functions:
  reader:
    handler: src/reader.handler
    build:
      mode: none
    iam:
      - readUsers
iam:
  statements:
    readUsers:
      actions:
        - dynamodb:GetItem
      resources:
        - "*"
`);

      expect(model.iam.statements.readUsers.actions).toEqual(["dynamodb:GetItem"]);
      template.hasResourceProperties(
        "AWS::IAM::Policy",
        Match.objectLike({
          PolicyDocument: {
            Statement: Match.arrayWith([
              Match.objectLike({
                Action: "dynamodb:GetItem",
                Resource: "*",
              }),
            ]),
          },
        }),
      );
    });
  });

  describe("invalid definitions", () => {
    test("rejects invalid YAML syntax", () => {
      const { filePath, plugin } = resolveDefinitionFromYaml(
        `
service: broken
functions:
  hello:
    handler: src/hello.handler
    build:
      mode: none
    events: [
`,
        "broken.yml",
      );

      expect(plugin.formatName).toBe("yamlcdk");
      expect(() => plugin.load(filePath)).toThrow();
    });

    test("rejects schema-invalid yamlcdk definitions", () => {
      expect(() =>
        buildDefinitionFromYaml(`
service: invalid-timeout
functions:
  hello:
    handler: src/hello.handler
    build:
      mode: none
    timeout: 0
`),
      ).toThrow("Invalid YAML config");
    });

    test("rejects impossible stack configurations after loading", () => {
      expect(() =>
        buildDefinitionFromYaml(`
service: invalid-s3-cleanup
storage:
  s3:
    uploads:
      autoDeleteObjects: true
`),
      ).toThrow("S3 auto-delete requires provider.s3.cleanupRoleArn");
    });
  });
});
