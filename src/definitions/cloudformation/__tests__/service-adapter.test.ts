import { describe, expect, test } from "vitest";
import { adaptCfnTemplate } from "../service-adapter.js";
import { parseCfnYaml } from "../cfn-yaml.js";
import { S3_CONFIG } from "../../../domains/s3/model.js";
import { DYNAMODB_CONFIG } from "../../../domains/dynamodb/model.js";
import { SQS_CONFIG } from "../../../domains/sqs/model.js";
import { SNS_CONFIG } from "../../../domains/sns/model.js";
import { EVENTBRIDGE_CONFIG } from "../../../domains/eventbridge/model.js";

describe("adaptCfnTemplate", () => {
  test("extracts service metadata", () => {
    const parsed = parseCfnYaml(`
AWSTemplateFormatVersion: "2010-09-09"
Metadata:
  yamlcdk:
    service: my-api
    stage: prod
    region: eu-west-1
    tags:
      env: production
Resources: {}
`);
    const model = adaptCfnTemplate(parsed, "template.yml");
    expect(model.service).toBe("my-api");
    expect(model.provider.stage).toBe("prod");
    expect(model.provider.region).toBe("eu-west-1");
    expect(model.stackName).toBe("my-api-prod");
    expect(model.provider.tags?.env).toBe("production");
  });

  test("derives service name from file path when metadata is absent", () => {
    const parsed = parseCfnYaml(`
AWSTemplateFormatVersion: "2010-09-09"
Resources: {}
`);
    const model = adaptCfnTemplate(parsed, "/path/to/infra.yml");
    expect(model.service).toBe("infra");
  });

  test("uses defaults for missing provider config", () => {
    const parsed = parseCfnYaml(`
AWSTemplateFormatVersion: "2010-09-09"
Resources: {}
`);
    const model = adaptCfnTemplate(parsed, "template.yml");
    expect(model.provider.stage).toBe("dev");
    expect(model.provider.region).toBe("us-east-1");
  });

  test("extracts Lambda functions", () => {
    const parsed = parseCfnYaml(`
AWSTemplateFormatVersion: "2010-09-09"
Metadata:
  yamlcdk:
    service: demo
Resources:
  HelloFunction:
    Type: AWS::Lambda::Function
    Properties:
      Handler: src/hello.handler
      Runtime: nodejs20.x
      Timeout: 10
      MemorySize: 512
      Environment:
        Variables:
          TABLE_NAME: users
`);
    const model = adaptCfnTemplate(parsed, "t.yml");
    expect(model.functions.HelloFunction).toBeDefined();
    expect(model.functions.HelloFunction.handler).toBe("src/hello.handler");
    expect(model.functions.HelloFunction.runtime).toBe("nodejs20.x");
    expect(model.functions.HelloFunction.timeout).toBe(10);
    expect(model.functions.HelloFunction.memorySize).toBe(512);
    expect(model.functions.HelloFunction.environment?.TABLE_NAME).toBe(
      "users",
    );
  });

  test("extracts Lambda function URLs into function config", () => {
    const parsed = parseCfnYaml(`
AWSTemplateFormatVersion: "2010-09-09"
Metadata:
  yamlcdk:
    service: demo
Resources:
  HelloFunction:
    Type: AWS::Lambda::Function
    Properties:
      Handler: src/hello.handler
  HelloFunctionUrl:
    Type: AWS::Lambda::Url
    Properties:
      TargetFunctionArn: !GetAtt HelloFunction.Arn
      AuthType: NONE
      InvokeMode: RESPONSE_STREAM
      Cors:
        AllowCredentials: true
        AllowHeaders:
          - Content-Type
        AllowMethods:
          - GET
        AllowOrigins:
          - https://example.com
        ExposeHeaders:
          - X-Trace-Id
        MaxAge: 300
`);
    const model = adaptCfnTemplate(parsed, "t.yml");

    expect(model.functions.HelloFunction.url).toEqual({
      authType: "NONE",
      invokeMode: "RESPONSE_STREAM",
      cors: {
        allowCredentials: true,
        allowHeaders: ["Content-Type"],
        allowedMethods: ["GET"],
        allowOrigins: ["https://example.com"],
        exposeHeaders: ["X-Trace-Id"],
        maxAge: 300,
      },
    });
  });

  test("extracts S3 buckets", () => {
    const parsed = parseCfnYaml(`
AWSTemplateFormatVersion: "2010-09-09"
Metadata:
  yamlcdk:
    service: demo
Resources:
  UploadsBucket:
    Type: AWS::S3::Bucket
    Properties:
      VersioningConfiguration:
        Status: Enabled
  LogsBucket:
    Type: AWS::S3::Bucket
`);
    const model = adaptCfnTemplate(parsed, "t.yml");
    const s3Config = model.domainConfigs.require(S3_CONFIG);
    expect(s3Config.buckets.UploadsBucket.versioned).toBe(true);
    expect(s3Config.buckets.LogsBucket.versioned).toBeUndefined();
  });

  test("extracts DynamoDB tables with partition and sort keys", () => {
    const parsed = parseCfnYaml(`
AWSTemplateFormatVersion: "2010-09-09"
Metadata:
  yamlcdk:
    service: demo
Resources:
  UsersTable:
    Type: AWS::DynamoDB::Table
    Properties:
      AttributeDefinitions:
        - AttributeName: pk
          AttributeType: S
        - AttributeName: sk
          AttributeType: N
      KeySchema:
        - AttributeName: pk
          KeyType: HASH
        - AttributeName: sk
          KeyType: RANGE
      BillingMode: PAY_PER_REQUEST
      StreamSpecification:
        StreamViewType: NEW_AND_OLD_IMAGES
`);
    const model = adaptCfnTemplate(parsed, "t.yml");
    const dynamoConfig = model.domainConfigs.require(DYNAMODB_CONFIG);
    const table = dynamoConfig.tables.UsersTable;
    expect(table.partitionKey).toEqual({ name: "pk", type: "string" });
    expect(table.sortKey).toEqual({ name: "sk", type: "number" });
    expect(table.billingMode).toBe("PAY_PER_REQUEST");
    expect(table.stream).toBe("NEW_AND_OLD_IMAGES");
  });

  test("extracts SQS queues", () => {
    const parsed = parseCfnYaml(`
AWSTemplateFormatVersion: "2010-09-09"
Metadata:
  yamlcdk:
    service: demo
Resources:
  JobsQueue:
    Type: AWS::SQS::Queue
    Properties:
      VisibilityTimeout: 60
`);
    const model = adaptCfnTemplate(parsed, "t.yml");
    const sqsConfig = model.domainConfigs.require(SQS_CONFIG);
    expect(sqsConfig.queues.JobsQueue.visibilityTimeout).toBe(60);
  });

  test("extracts SNS topics with SQS subscriptions", () => {
    const parsed = parseCfnYaml(`
AWSTemplateFormatVersion: "2010-09-09"
Metadata:
  yamlcdk:
    service: demo
Resources:
  EventsTopic:
    Type: AWS::SNS::Topic
  JobsQueue:
    Type: AWS::SQS::Queue
  EventsToJobs:
    Type: AWS::SNS::Subscription
    Properties:
      Protocol: sqs
      TopicArn: !Ref EventsTopic
      Endpoint: !GetAtt JobsQueue.Arn
`);
    const model = adaptCfnTemplate(parsed, "t.yml");
    const snsConfig = model.domainConfigs.require(SNS_CONFIG);
    expect(snsConfig.topics.EventsTopic.subscriptions).toHaveLength(1);
    expect(snsConfig.topics.EventsTopic.subscriptions![0]).toEqual({
      type: "sqs",
      target: "JobsQueue",
    });
  });

  test("extracts extended SNS topic properties and subscription options", () => {
    const parsed = parseCfnYaml(`
AWSTemplateFormatVersion: "2010-09-09"
Metadata:
  yamlcdk:
    service: demo
Resources:
  ProcessorFunction:
    Type: AWS::Lambda::Function
    Properties:
      Handler: src/processor.handler
  JobsQueue:
    Type: AWS::SQS::Queue
  AlertsTopic:
    Type: AWS::SNS::Topic
    Properties:
      TopicName: alerts-topic.fifo
      DisplayName: Alerts
      FifoTopic: true
      ContentBasedDeduplication: true
      FifoThroughputScope: MessageGroup
      KmsMasterKeyId: alias/aws/sns
      SignatureVersion: "2"
      TracingConfig: Active
      ArchivePolicy:
        MessageRetentionPeriod: "7"
      DataProtectionPolicy:
        Name: alerts-policy
      DeliveryStatusLogging:
        - Protocol: lambda
          SuccessFeedbackSampleRate: 100
      Tags:
        - Key: Team
          Value: platform
      Subscription:
        - Protocol: sqs
          Endpoint: !GetAtt JobsQueue.Arn
  AlertsToProcessor:
    Type: AWS::SNS::Subscription
    Properties:
      Protocol: lambda
      TopicArn: !Ref AlertsTopic
      Endpoint: !GetAtt ProcessorFunction.Arn
      FilterPolicy:
        severity:
          - high
      RawMessageDelivery: true
`);
    const model = adaptCfnTemplate(parsed, "t.yml");
    const snsConfig = model.domainConfigs.require(SNS_CONFIG);

    expect(snsConfig.topics.AlertsTopic).toEqual(
      expect.objectContaining({
        topicName: "alerts-topic.fifo",
        displayName: "Alerts",
        fifoTopic: true,
        contentBasedDeduplication: true,
        fifoThroughputScope: "MessageGroup",
        kmsMasterKeyId: "alias/aws/sns",
        signatureVersion: "2",
        tracingConfig: "Active",
        archivePolicy: { MessageRetentionPeriod: "7" },
        dataProtectionPolicy: { Name: "alerts-policy" },
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
    expect(snsConfig.topics.AlertsTopic.subscriptions).toEqual(
      expect.arrayContaining([
        {
          type: "sqs",
          target: "JobsQueue",
        },
        {
          type: "lambda",
          target: "ProcessorFunction",
          filterPolicy: {
            severity: ["high"],
          },
          rawMessageDelivery: true,
        },
      ]),
    );

    const processorEvents = model.functions.ProcessorFunction.events;
    expect(processorEvents).toEqual(
      expect.arrayContaining([{ type: "sns", topic: "AlertsTopic" }]),
    );
  });
});

describe("event wiring", () => {
  test("wires SQS EventSourceMapping to function", () => {
    const parsed = parseCfnYaml(`
AWSTemplateFormatVersion: "2010-09-09"
Metadata:
  yamlcdk:
    service: demo
Resources:
  MyFunction:
    Type: AWS::Lambda::Function
    Properties:
      Handler: src/handler.handler
  MyQueue:
    Type: AWS::SQS::Queue
  MyMapping:
    Type: AWS::Lambda::EventSourceMapping
    Properties:
      FunctionName: !Ref MyFunction
      EventSourceArn: !GetAtt MyQueue.Arn
      BatchSize: 5
`);
    const model = adaptCfnTemplate(parsed, "t.yml");
    const events = model.functions.MyFunction.events;
    expect(events).toHaveLength(1);
    expect(events[0].type).toBe("sqs");
    if (events[0].type === "sqs") {
      expect(events[0].queue).toBe("MyQueue");
      expect(events[0].batchSize).toBe(5);
    }
  });

  test("wires DynamoDB EventSourceMapping to function", () => {
    const parsed = parseCfnYaml(`
AWSTemplateFormatVersion: "2010-09-09"
Metadata:
  yamlcdk:
    service: demo
Resources:
  ProcessFunction:
    Type: AWS::Lambda::Function
    Properties:
      Handler: src/process.handler
  OrdersTable:
    Type: AWS::DynamoDB::Table
    Properties:
      AttributeDefinitions:
        - AttributeName: pk
          AttributeType: S
      KeySchema:
        - AttributeName: pk
          KeyType: HASH
      StreamSpecification:
        StreamViewType: NEW_IMAGE
  StreamMapping:
    Type: AWS::Lambda::EventSourceMapping
    Properties:
      FunctionName: !Ref ProcessFunction
      EventSourceArn: !GetAtt OrdersTable.StreamArn
      BatchSize: 100
      StartingPosition: TRIM_HORIZON
`);
    const model = adaptCfnTemplate(parsed, "t.yml");
    const events = model.functions.ProcessFunction.events;
    expect(events).toHaveLength(1);
    expect(events[0].type).toBe("dynamodb-stream");
    if (events[0].type === "dynamodb-stream") {
      expect(events[0].table).toBe("OrdersTable");
      expect(events[0].batchSize).toBe(100);
      expect(events[0].startingPosition).toBe("TRIM_HORIZON");
    }
  });

  test("wires SNS Lambda subscription to function", () => {
    const parsed = parseCfnYaml(`
AWSTemplateFormatVersion: "2010-09-09"
Metadata:
  yamlcdk:
    service: demo
Resources:
  NotifyFunction:
    Type: AWS::Lambda::Function
    Properties:
      Handler: src/notify.handler
  AlertsTopic:
    Type: AWS::SNS::Topic
  NotifySub:
    Type: AWS::SNS::Subscription
    Properties:
      Protocol: lambda
      TopicArn: !Ref AlertsTopic
      Endpoint: !GetAtt NotifyFunction.Arn
`);
    const model = adaptCfnTemplate(parsed, "t.yml");
    const events = model.functions.NotifyFunction.events;
    expect(events).toHaveLength(1);
    expect(events[0].type).toBe("sns");
    if (events[0].type === "sns") {
      expect(events[0].topic).toBe("AlertsTopic");
    }
  });

  test("wires S3 notification to function", () => {
    const parsed = parseCfnYaml(`
AWSTemplateFormatVersion: "2010-09-09"
Metadata:
  yamlcdk:
    service: demo
Resources:
  ProcessFunction:
    Type: AWS::Lambda::Function
    Properties:
      Handler: src/process.handler
  DataBucket:
    Type: AWS::S3::Bucket
    Properties:
      NotificationConfiguration:
        LambdaConfigurations:
          - Event: s3:ObjectCreated:*
            Function: !GetAtt ProcessFunction.Arn
`);
    const model = adaptCfnTemplate(parsed, "t.yml");
    const events = model.functions.ProcessFunction.events;
    expect(events).toHaveLength(1);
    expect(events[0].type).toBe("s3");
    if (events[0].type === "s3") {
      expect(events[0].bucket).toBe("DataBucket");
      expect(events[0].events).toEqual(["s3:ObjectCreated:*"]);
    }
  });

  test("wires EventBridge schedule rule to function", () => {
    const parsed = parseCfnYaml(`
AWSTemplateFormatVersion: "2010-09-09"
Metadata:
  yamlcdk:
    service: demo
Resources:
  CronFunction:
    Type: AWS::Lambda::Function
    Properties:
      Handler: src/cron.handler
  HourlyRule:
    Type: AWS::Events::Rule
    Properties:
      ScheduleExpression: "rate(1 hour)"
      Targets:
        - Arn: !GetAtt CronFunction.Arn
          Id: CronTarget
`);
    const model = adaptCfnTemplate(parsed, "t.yml");
    const events = model.functions.CronFunction.events;
    expect(events).toHaveLength(1);
    expect(events[0].type).toBe("eventbridge");
    if (events[0].type === "eventbridge") {
      expect(events[0].schedule).toBe("rate(1 hour)");
    }
  });

  test("wires EventBridge event pattern rule to function", () => {
    const parsed = parseCfnYaml(`
AWSTemplateFormatVersion: "2010-09-09"
Metadata:
  yamlcdk:
    service: demo
Resources:
  HandlerFunction:
    Type: AWS::Lambda::Function
    Properties:
      Handler: src/handler.handler
  PatternRule:
    Type: AWS::Events::Rule
    Properties:
      EventPattern:
        source:
          - aws.s3
      Targets:
        - Arn: !GetAtt HandlerFunction.Arn
          Id: HandlerTarget
`);
    const model = adaptCfnTemplate(parsed, "t.yml");
    const events = model.functions.HandlerFunction.events;
    expect(events).toHaveLength(1);
    expect(events[0].type).toBe("eventbridge");
    if (events[0].type === "eventbridge") {
      expect(events[0].eventPattern).toEqual({ source: ["aws.s3"] });
    }
  });

  test("wires EventBridge rule with custom EventBusName to function", () => {
    const busArn = "arn:aws:events:us-east-1:123456789012:event-bus/custom";
    const parsed = parseCfnYaml(`
AWSTemplateFormatVersion: "2010-09-09"
Metadata:
  yamlcdk:
    service: demo
Resources:
  HandlerFunction:
    Type: AWS::Lambda::Function
    Properties:
      Handler: src/handler.handler
  CustomBusRule:
    Type: AWS::Events::Rule
    Properties:
      EventBusName: ${busArn}
      EventPattern:
        source:
          - marketing
      Targets:
        - Arn: !GetAtt HandlerFunction.Arn
          Id: HandlerTarget
`);
    const model = adaptCfnTemplate(parsed, "t.yml");
    const events = model.functions.HandlerFunction.events;
    expect(events).toHaveLength(1);
    expect(events[0].type).toBe("eventbridge");
    if (events[0].type === "eventbridge") {
      expect(events[0].eventBus).toBe(busArn);
      expect(events[0].eventPattern).toEqual({ source: ["marketing"] });
    }
  });

  test("wires EventBridge rule with EventBusName Ref to function", () => {
    const parsed = parseCfnYaml(`
AWSTemplateFormatVersion: "2010-09-09"
Metadata:
  yamlcdk:
    service: demo
Resources:
  HandlerFunction:
    Type: AWS::Lambda::Function
    Properties:
      Handler: src/handler.handler
  CustomBus:
    Type: AWS::Events::EventBus
    Properties:
      Name: marketing
  CustomBusRule:
    Type: AWS::Events::Rule
    Properties:
      EventBusName: !Ref CustomBus
      EventPattern:
        source:
          - marketing
      Targets:
        - Arn: !GetAtt HandlerFunction.Arn
          Id: HandlerTarget
`);
    const model = adaptCfnTemplate(parsed, "t.yml");
    const events = model.functions.HandlerFunction.events;
    expect(events).toHaveLength(1);
    expect(events[0].type).toBe("eventbridge");
    if (events[0].type === "eventbridge") {
      expect(events[0].eventBus).toEqual({ Ref: "CustomBus" });
      expect(events[0].eventPattern).toEqual({ source: ["marketing"] });
    }
  });

  test("extracts AWS::Events::EventBus into eventbridge domain config", () => {
    const parsed = parseCfnYaml(`
AWSTemplateFormatVersion: "2010-09-09"
Metadata:
  yamlcdk:
    service: demo
Resources:
  CustomBus:
    Type: AWS::Events::EventBus
    Properties:
      Name: marketing
      Description: Marketing event bus
`);
    const model = adaptCfnTemplate(parsed, "t.yml");
    const config = model.domainConfigs.get(EVENTBRIDGE_CONFIG);
    expect(config?.eventBuses.CustomBus).toEqual({
      eventBusName: "marketing",
      description: "Marketing event bus",
      eventSourceName: undefined,
    });
  });

  test("wires HTTP API route to function via integration", () => {
    const parsed = parseCfnYaml(`
AWSTemplateFormatVersion: "2010-09-09"
Metadata:
  yamlcdk:
    service: demo
Resources:
  ApiFunction:
    Type: AWS::Lambda::Function
    Properties:
      Handler: src/api.handler
  HttpApi:
    Type: AWS::ApiGatewayV2::Api
    Properties:
      ProtocolType: HTTP
  ApiIntegration:
    Type: AWS::ApiGatewayV2::Integration
    Properties:
      ApiId: !Ref HttpApi
      IntegrationType: AWS_PROXY
      IntegrationUri: !GetAtt ApiFunction.Arn
  GetRoute:
    Type: AWS::ApiGatewayV2::Route
    Properties:
      ApiId: !Ref HttpApi
      RouteKey: "GET /items"
      Target: !Join ["/", ["integrations", !Ref ApiIntegration]]
  PostRoute:
    Type: AWS::ApiGatewayV2::Route
    Properties:
      ApiId: !Ref HttpApi
      RouteKey: "POST /items"
      Target: !Join ["/", ["integrations", !Ref ApiIntegration]]
`);
    const model = adaptCfnTemplate(parsed, "t.yml");
    const events = model.functions.ApiFunction.events;
    expect(events).toHaveLength(2);
    const httpEvents = events.filter((e) => e.type === "http");
    expect(httpEvents).toHaveLength(2);
    const methods = httpEvents.map((e) =>
      e.type === "http" ? e.method : "",
    );
    expect(methods.sort()).toEqual(["GET", "POST"]);
  });

  test("normalizes HTTP API route method and path via shared adapters", () => {
    const parsed = parseCfnYaml(`
AWSTemplateFormatVersion: "2010-09-09"
Metadata:
  yamlcdk:
    service: demo
Resources:
  ApiFunction:
    Type: AWS::Lambda::Function
    Properties:
      Handler: src/api.handler
  HttpApi:
    Type: AWS::ApiGatewayV2::Api
    Properties:
      ProtocolType: HTTP
  ApiIntegration:
    Type: AWS::ApiGatewayV2::Integration
    Properties:
      ApiId: !Ref HttpApi
      IntegrationType: AWS_PROXY
      IntegrationUri: !GetAtt ApiFunction.Arn
  PostRoute:
    Type: AWS::ApiGatewayV2::Route
    Properties:
      ApiId: !Ref HttpApi
      RouteKey: "post items"
      Target: !Join ["/", ["integrations", !Ref ApiIntegration]]
`);

    const model = adaptCfnTemplate(parsed, "t.yml");
    expect(model.functions.ApiFunction.events).toEqual([
      { type: "http", method: "POST", path: "/items" },
    ]);
  });

  test("rejects Lambda function URLs with Qualifier", () => {
    const parsed = parseCfnYaml(`
AWSTemplateFormatVersion: "2010-09-09"
Metadata:
  yamlcdk:
    service: demo
Resources:
  HelloFunction:
    Type: AWS::Lambda::Function
    Properties:
      Handler: src/hello.handler
  HelloFunctionUrl:
    Type: AWS::Lambda::Url
    Properties:
      TargetFunctionArn: !GetAtt HelloFunction.Arn
      AuthType: NONE
      Qualifier: live
`);

    expect(() => adaptCfnTemplate(parsed, "t.yml")).toThrow(
      "does not support yet",
    );
  });

  test("wires multiple event types to the same function", () => {
    const parsed = parseCfnYaml(`
AWSTemplateFormatVersion: "2010-09-09"
Metadata:
  yamlcdk:
    service: demo
Resources:
  MultiFn:
    Type: AWS::Lambda::Function
    Properties:
      Handler: src/multi.handler
  Queue:
    Type: AWS::SQS::Queue
  Topic:
    Type: AWS::SNS::Topic
  SqsMapping:
    Type: AWS::Lambda::EventSourceMapping
    Properties:
      FunctionName: !Ref MultiFn
      EventSourceArn: !GetAtt Queue.Arn
  TopicSub:
    Type: AWS::SNS::Subscription
    Properties:
      Protocol: lambda
      TopicArn: !Ref Topic
      Endpoint: !GetAtt MultiFn.Arn
  ScheduleRule:
    Type: AWS::Events::Rule
    Properties:
      ScheduleExpression: "rate(5 minutes)"
      Targets:
        - Arn: !GetAtt MultiFn.Arn
          Id: MultiFnTarget
`);
    const model = adaptCfnTemplate(parsed, "t.yml");
    const events = model.functions.MultiFn.events;
    expect(events).toHaveLength(3);
    const types = events.map((e) => e.type).sort();
    expect(types).toEqual(["eventbridge", "sns", "sqs"]);
  });
});
