import { Match } from "aws-cdk-lib/assertions";
import { describe, expect, test } from "vitest";
import {
  buildDefinitionFromYaml,
  resolveDefinitionFromYaml,
} from "../../test-utils/e2e.js";

describe("cloudformation definition e2e", () => {
  describe("metadata section", () => {
    test("loads yamlcdk metadata into the adapted service model", () => {
      const { plugin, model, template } = buildDefinitionFromYaml(`
AWSTemplateFormatVersion: "2010-09-09"
Metadata:
  yamlcdk:
    service: metadata-service
    stage: prod
    region: eu-west-1
    account: "123456789012"
    profile: platform
    tags:
      team: core
    deployment:
      qualifier: custom-qualifier
Resources:
  HelloFunction:
    Type: AWS::Lambda::Function
    Properties:
      Handler: src/hello.handler
`);

      expect(plugin.formatName).toBe("cloudformation");
      expect(model.service).toBe("metadata-service");
      expect(model.provider.stage).toBe("prod");
      expect(model.provider.region).toBe("eu-west-1");
      expect(model.provider.account).toBe("123456789012");
      expect(model.provider.profile).toBe("platform");
      expect(model.provider.tags?.team).toBe("core");
      expect(model.provider.deployment?.qualifier).toBe("custom-qualifier");
      template.resourceCountIs("AWS::Lambda::Function", 1);
    });

    test("derives service metadata defaults from the file path when metadata is absent", () => {
      const { plugin, model, template } = buildDefinitionFromYaml(
        `
AWSTemplateFormatVersion: "2010-09-09"
Resources:
  DerivedFunction:
    Type: AWS::Lambda::Function
    Properties:
      Handler: src/derived.handler
`,
        "orders-service.yml",
      );

      expect(plugin.formatName).toBe("cloudformation");
      expect(model.service).toBe("orders-service");
      expect(model.provider.stage).toBe("dev");
      expect(model.provider.region).toBe("us-east-1");
      expect(model.stackName).toBe("orders-service-dev");
      template.resourceCountIs("AWS::Lambda::Function", 1);
    });
  });

  describe("function resources", () => {
    test("adapts lambda runtime, timeout, memory, and environment settings", () => {
      const { model, template } = buildDefinitionFromYaml(`
AWSTemplateFormatVersion: "2010-09-09"
Metadata:
  yamlcdk:
    service: function-options
    region: us-east-1
Resources:
  WorkerFunction:
    Type: AWS::Lambda::Function
    Properties:
      Handler: src/worker.handler
      Runtime: nodejs22.x
      Timeout: 45
      MemorySize: 512
      Environment:
        Variables:
          STAGE: prod
`);

      expect(model.functions.WorkerFunction.runtime).toBe("nodejs22.x");
      expect(model.functions.WorkerFunction.timeout).toBe(45);
      expect(model.functions.WorkerFunction.memorySize).toBe(512);
      expect(model.functions.WorkerFunction.environment?.STAGE).toBe("prod");
      template.hasResourceProperties(
        "AWS::Lambda::Function",
        Match.objectLike({
          Runtime: "nodejs22.x",
          Timeout: 45,
          MemorySize: 512,
          Environment: {
            Variables: {
              STAGE: "prod",
            },
          },
        }),
      );
    });

    test("creates a lambda function URL from AWS::Lambda::Url", () => {
      const { model, template } = buildDefinitionFromYaml(`
AWSTemplateFormatVersion: "2010-09-09"
Metadata:
  yamlcdk:
    service: function-url
    region: us-east-1
Resources:
  WorkerFunction:
    Type: AWS::Lambda::Function
    Properties:
      Handler: src/worker.handler
  WorkerFunctionUrl:
    Type: AWS::Lambda::Url
    Properties:
      TargetFunctionArn: !GetAtt WorkerFunction.Arn
      AuthType: NONE
      Cors:
        AllowMethods:
          - GET
        AllowOrigins:
          - https://example.com
`);

      expect(model.functions.WorkerFunction.url).toEqual({
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
      template.hasOutput("WorkerFunctionFunctionUrl", {});
    });
  });

  describe("storage resources", () => {
    test("creates an S3 bucket with versioning when configured", () => {
      const { template } = buildDefinitionFromYaml(`
AWSTemplateFormatVersion: "2010-09-09"
Metadata:
  yamlcdk:
    service: versioned-bucket
Resources:
  UploadsBucket:
    Type: AWS::S3::Bucket
    Properties:
      VersioningConfiguration:
        Status: Enabled
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

    test("creates a DynamoDB table with only the required partition key", () => {
      const { template } = buildDefinitionFromYaml(`
AWSTemplateFormatVersion: "2010-09-09"
Metadata:
  yamlcdk:
    service: dynamodb-partition
Resources:
  OrdersTable:
    Type: AWS::DynamoDB::Table
    Properties:
      AttributeDefinitions:
        - AttributeName: pk
          AttributeType: S
      KeySchema:
        - AttributeName: pk
          KeyType: HASH
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
AWSTemplateFormatVersion: "2010-09-09"
Metadata:
  yamlcdk:
    service: dynamodb-optionals
Resources:
  OrdersTable:
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
      StreamSpecification:
        StreamViewType: NEW_AND_OLD_IMAGES
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

  describe("messaging resources", () => {
    test("creates an SQS queue with visibilityTimeout when configured", () => {
      const { template } = buildDefinitionFromYaml(`
AWSTemplateFormatVersion: "2010-09-09"
Metadata:
  yamlcdk:
    service: sqs-timeout
Resources:
  JobsQueue:
    Type: AWS::SQS::Queue
    Properties:
      VisibilityTimeout: 45
`);

      template.hasResourceProperties(
        "AWS::SQS::Queue",
        Match.objectLike({
          VisibilityTimeout: 45,
        }),
      );
    });

    test("creates an SNS to SQS subscription from CloudFormation resources", () => {
      const { template } = buildDefinitionFromYaml(`
AWSTemplateFormatVersion: "2010-09-09"
Metadata:
  yamlcdk:
    service: sns-to-sqs
Resources:
  JobsQueue:
    Type: AWS::SQS::Queue
  AlertsTopic:
    Type: AWS::SNS::Topic
  AlertsToJobs:
    Type: AWS::SNS::Subscription
    Properties:
      Protocol: sqs
      TopicArn: !Ref AlertsTopic
      Endpoint: !GetAtt JobsQueue.Arn
`);

      template.hasResourceProperties(
        "AWS::SNS::Subscription",
        Match.objectLike({
          Protocol: "sqs",
        }),
      );
    });

    test("preserves extended SNS topic and subscription properties", () => {
      const { template } = buildDefinitionFromYaml(`
AWSTemplateFormatVersion: "2010-09-09"
Metadata:
  yamlcdk:
    service: sns-extended
Resources:
  WorkerFunction:
    Type: AWS::Lambda::Function
    Properties:
      Handler: src/worker.handler
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
  AlertsToWorker:
    Type: AWS::SNS::Subscription
    Properties:
      Protocol: lambda
      TopicArn: !Ref AlertsTopic
      Endpoint: !GetAtt WorkerFunction.Arn
      FilterPolicy:
        severity:
          - high
      RawMessageDelivery: true
`);

      template.hasResourceProperties(
        "AWS::SNS::Topic",
        Match.objectLike({
          TopicName: "alerts-topic.fifo",
          DisplayName: "Alerts",
          FifoTopic: true,
          ContentBasedDeduplication: true,
          FifoThroughputScope: "MessageGroup",
          KmsMasterKeyId: "alias/aws/sns",
          SignatureVersion: "2",
          TracingConfig: "Active",
          ArchivePolicy: {
            MessageRetentionPeriod: "7",
          },
          DataProtectionPolicy: {
            Name: "alerts-policy",
          },
          DeliveryStatusLogging: Match.arrayWith([
            Match.objectLike({
              Protocol: "lambda",
              SuccessFeedbackSampleRate: "100",
            }),
          ]),
        }),
      );
      template.hasResourceProperties(
        "AWS::SNS::Subscription",
        Match.objectLike({
          Protocol: "lambda",
          FilterPolicy: {
            severity: ["high"],
          },
          RawMessageDelivery: true,
        }),
      );
    });
  });

  describe("event wiring resources", () => {
    test("creates an event source mapping for an SQS event source mapping resource", () => {
      const { model, template } = buildDefinitionFromYaml(`
AWSTemplateFormatVersion: "2010-09-09"
Metadata:
  yamlcdk:
    service: sqs-event
Resources:
  WorkerFunction:
    Type: AWS::Lambda::Function
    Properties:
      Handler: src/worker.handler
  JobsQueue:
    Type: AWS::SQS::Queue
  QueueMapping:
    Type: AWS::Lambda::EventSourceMapping
    Properties:
      FunctionName: !Ref WorkerFunction
      EventSourceArn: !GetAtt JobsQueue.Arn
      BatchSize: 5
`);

      expect(model.functions.WorkerFunction.events.map((event) => event.type)).toEqual(
        ["sqs"],
      );
      template.hasResourceProperties(
        "AWS::Lambda::EventSourceMapping",
        Match.objectLike({
          BatchSize: 5,
        }),
      );
    });

    test("creates an event source mapping for a DynamoDB stream resource", () => {
      const { model, template } = buildDefinitionFromYaml(`
AWSTemplateFormatVersion: "2010-09-09"
Metadata:
  yamlcdk:
    service: dynamodb-stream-event
Resources:
  WorkerFunction:
    Type: AWS::Lambda::Function
    Properties:
      Handler: src/worker.handler
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
        StreamViewType: NEW_AND_OLD_IMAGES
  StreamMapping:
    Type: AWS::Lambda::EventSourceMapping
    Properties:
      FunctionName: !Ref WorkerFunction
      EventSourceArn: !GetAtt OrdersTable.StreamArn
      StartingPosition: LATEST
`);

      expect(model.functions.WorkerFunction.events.map((event) => event.type)).toEqual(
        ["dynamodb-stream"],
      );
      template.hasResourceProperties(
        "AWS::Lambda::EventSourceMapping",
        Match.objectLike({
          StartingPosition: "LATEST",
        }),
      );
    });

    test("creates an SNS lambda subscription for a lambda-targeted subscription", () => {
      const { model, template } = buildDefinitionFromYaml(`
AWSTemplateFormatVersion: "2010-09-09"
Metadata:
  yamlcdk:
    service: sns-lambda-event
Resources:
  WorkerFunction:
    Type: AWS::Lambda::Function
    Properties:
      Handler: src/worker.handler
  AlertsTopic:
    Type: AWS::SNS::Topic
  AlertsToWorker:
    Type: AWS::SNS::Subscription
    Properties:
      Protocol: lambda
      TopicArn: !Ref AlertsTopic
      Endpoint: !GetAtt WorkerFunction.Arn
`);

      expect(model.functions.WorkerFunction.events.map((event) => event.type)).toEqual(
        ["sns"],
      );
      template.hasResourceProperties(
        "AWS::SNS::Subscription",
        Match.objectLike({
          Protocol: "lambda",
        }),
      );
    });

    test("creates an S3 notification custom resource from bucket notifications", () => {
      const { model, template } = buildDefinitionFromYaml(`
AWSTemplateFormatVersion: "2010-09-09"
Metadata:
  yamlcdk:
    service: s3-event
Resources:
  ProcessorFunction:
    Type: AWS::Lambda::Function
    Properties:
      Handler: src/processor.handler
  UploadsBucket:
    Type: AWS::S3::Bucket
    Properties:
      NotificationConfiguration:
        LambdaConfigurations:
          - Event: s3:ObjectCreated:*
            Function: !GetAtt ProcessorFunction.Arn
`);

      expect(model.functions.ProcessorFunction.events.map((event) => event.type)).toEqual(
        ["s3"],
      );
      template.resourceCountIs("Custom::S3BucketNotifications", 1);
    });

    test("creates an EventBridge rule for a schedule-based rule", () => {
      const { model, template } = buildDefinitionFromYaml(`
AWSTemplateFormatVersion: "2010-09-09"
Metadata:
  yamlcdk:
    service: schedule-event
Resources:
  WorkerFunction:
    Type: AWS::Lambda::Function
    Properties:
      Handler: src/worker.handler
  HourlyRule:
    Type: AWS::Events::Rule
    Properties:
      ScheduleExpression: rate(1 hour)
      Targets:
        - Arn: !GetAtt WorkerFunction.Arn
          Id: WorkerTarget
`);

      expect(model.functions.WorkerFunction.events.map((event) => event.type)).toEqual(
        ["eventbridge"],
      );
      template.hasResourceProperties(
        "AWS::Events::Rule",
        Match.objectLike({
          ScheduleExpression: "rate(1 hour)",
        }),
      );
    });

    test("creates an EventBridge rule for an event-pattern rule", () => {
      const { model, template } = buildDefinitionFromYaml(`
AWSTemplateFormatVersion: "2010-09-09"
Metadata:
  yamlcdk:
    service: pattern-event
Resources:
  WorkerFunction:
    Type: AWS::Lambda::Function
    Properties:
      Handler: src/worker.handler
  OrdersRule:
    Type: AWS::Events::Rule
    Properties:
      EventPattern:
        source:
          - orders
      Targets:
        - Arn: !GetAtt WorkerFunction.Arn
          Id: WorkerTarget
`);

      expect(model.functions.WorkerFunction.events.map((event) => event.type)).toEqual(
        ["eventbridge"],
      );
      template.hasResourceProperties(
        "AWS::Events::Rule",
        Match.objectLike({
          EventPattern: {
            source: ["orders"],
          },
        }),
      );
    });

    test("creates and wires AWS::Events::EventBus via Ref", () => {
      const { model, template } = buildDefinitionFromYaml(`
AWSTemplateFormatVersion: "2010-09-09"
Metadata:
  yamlcdk:
    service: custom-event-bus
Resources:
  WorkerFunction:
    Type: AWS::Lambda::Function
    Properties:
      Handler: src/worker.handler
  CustomBus:
    Type: AWS::Events::EventBus
    Properties:
      Name: marketing
  OrdersRule:
    Type: AWS::Events::Rule
    Properties:
      EventBusName: !Ref CustomBus
      EventPattern:
        source:
          - marketing
      Targets:
        - Arn: !GetAtt WorkerFunction.Arn
          Id: WorkerTarget
`);

      expect(model.functions.WorkerFunction.events.map((event) => event.type)).toEqual(
        ["eventbridge"],
      );
      template.resourceCountIs("AWS::Events::EventBus", 1);
      template.hasResourceProperties(
        "AWS::Events::EventBus",
        Match.objectLike({
          Name: "marketing",
        }),
      );
      template.hasResourceProperties(
        "AWS::Events::Rule",
        Match.objectLike({
          EventBusName: { Ref: Match.anyValue() },
          EventPattern: {
            source: ["marketing"],
          },
        }),
      );
    });

    test("creates an HTTP API route from ApiGatewayV2 route wiring", () => {
      const { plugin, model, template } = buildDefinitionFromYaml(`
AWSTemplateFormatVersion: "2010-09-09"
Metadata:
  yamlcdk:
    service: demo-http
    stage: prod
    region: us-east-1
Resources:
  HelloFunction:
    Type: AWS::Lambda::Function
    Properties:
      Handler: src/hello.handler
  HttpApi:
    Type: AWS::ApiGatewayV2::Api
    Properties:
      ProtocolType: HTTP
  HelloIntegration:
    Type: AWS::ApiGatewayV2::Integration
    Properties:
      ApiId: !Ref HttpApi
      IntegrationType: AWS_PROXY
      IntegrationUri: !GetAtt HelloFunction.Arn
      PayloadFormatVersion: "2.0"
  HelloRoute:
    Type: AWS::ApiGatewayV2::Route
    Properties:
      ApiId: !Ref HttpApi
      RouteKey: "GET /hello"
      Target: !Join ["/", ["integrations", !Ref HelloIntegration]]
`);

      expect(plugin.formatName).toBe("cloudformation");
      expect(model.stackName).toBe("demo-http-prod");
      expect(model.functions.HelloFunction.events.map((event) => event.type)).toEqual([
        "http",
      ]);
      template.hasOutput("HttpApiUrl", {});
      template.resourceCountIs("AWS::ApiGatewayV2::Route", 1);
    });
  });

  describe("invalid definitions", () => {
    test("rejects invalid CloudFormation YAML syntax", () => {
      const { filePath, plugin } = resolveDefinitionFromYaml(
        `
AWSTemplateFormatVersion: "2010-09-09"
Resources:
  Broken:
    Type: AWS::Lambda::Function
    Properties:
      Handler: [
`,
        "broken-template.yml",
      );

      expect(plugin.formatName).toBe("cloudformation");
      expect(() => plugin.load(filePath)).toThrow();
    });

    test("rejects invalid yamlcdk metadata values during model validation", () => {
      expect(() =>
        buildDefinitionFromYaml(`
AWSTemplateFormatVersion: "2010-09-09"
Metadata:
  yamlcdk:
    service: ""
Resources:
  BrokenFunction:
    Type: AWS::Lambda::Function
    Properties:
      Handler: src/broken.handler
`),
      ).toThrow();
    });

    test("rejects lambda function URLs that use Qualifier", () => {
      expect(() =>
        buildDefinitionFromYaml(`
AWSTemplateFormatVersion: "2010-09-09"
Metadata:
  yamlcdk:
    service: invalid-function-url
Resources:
  WorkerFunction:
    Type: AWS::Lambda::Function
    Properties:
      Handler: src/worker.handler
  WorkerFunctionUrl:
    Type: AWS::Lambda::Url
    Properties:
      TargetFunctionArn: !GetAtt WorkerFunction.Arn
      AuthType: NONE
      Qualifier: live
`),
      ).toThrow("does not support yet");
    });
  });

  describe("CloudFront resources", () => {
    test("creates a CachePolicy from AWS::CloudFront::CachePolicy resource", () => {
      const { model, template } = buildDefinitionFromYaml(`
AWSTemplateFormatVersion: "2010-09-09"
Metadata:
  yamlcdk:
    service: cf-cache-policy
Resources:
  ApiCachePolicy:
    Type: AWS::CloudFront::CachePolicy
    Properties:
      CachePolicyConfig:
        Name: api-cache-policy
        DefaultTTL: 0
        MinTTL: 0
        MaxTTL: 31536000
        ParametersInCacheKeyAndForwardedToOrigin:
          HeadersConfig:
            HeaderBehavior: none
          CookiesConfig:
            CookieBehavior: none
          QueryStringsConfig:
            QueryStringBehavior: all
          EnableAcceptEncodingGzip: true
`);

      expect(model.domainConfigs.get({ id: "cloudfront" } as never)).toBeDefined();
      template.resourceCountIs("AWS::CloudFront::CachePolicy", 1);
      template.hasResourceProperties(
        "AWS::CloudFront::CachePolicy",
        Match.objectLike({
          CachePolicyConfig: Match.objectLike({
            DefaultTTL: 0,
          }),
        }),
      );
    });

    test("creates an OriginRequestPolicy from AWS::CloudFront::OriginRequestPolicy resource", () => {
      const { template } = buildDefinitionFromYaml(`
AWSTemplateFormatVersion: "2010-09-09"
Metadata:
  yamlcdk:
    service: cf-origin-request-policy
Resources:
  AllViewerPolicy:
    Type: AWS::CloudFront::OriginRequestPolicy
    Properties:
      OriginRequestPolicyConfig:
        Name: all-viewer
        HeadersConfig:
          HeaderBehavior: allViewer
        CookiesConfig:
          CookieBehavior: none
        QueryStringsConfig:
          QueryStringBehavior: none
`);

      template.resourceCountIs("AWS::CloudFront::OriginRequestPolicy", 1);
    });

    test("creates a Distribution referencing a CachePolicy via !Ref", () => {
      const { template } = buildDefinitionFromYaml(`
AWSTemplateFormatVersion: "2010-09-09"
Metadata:
  yamlcdk:
    service: cf-distribution
Resources:
  ApiCachePolicy:
    Type: AWS::CloudFront::CachePolicy
    Properties:
      CachePolicyConfig:
        Name: api-cache-policy
        DefaultTTL: 0
        MinTTL: 0
        MaxTTL: 31536000
        ParametersInCacheKeyAndForwardedToOrigin:
          HeadersConfig:
            HeaderBehavior: none
          CookiesConfig:
            CookieBehavior: none
          QueryStringsConfig:
            QueryStringBehavior: none
          EnableAcceptEncodingGzip: true
  ApiDistribution:
    Type: AWS::CloudFront::Distribution
    Properties:
      DistributionConfig:
        Origins:
          - Id: apiOrigin
            DomainName: xyz.execute-api.us-east-1.amazonaws.com
            CustomOriginConfig:
              HTTPSPort: 443
              OriginProtocolPolicy: https-only
        DefaultCacheBehavior:
          TargetOriginId: apiOrigin
          ViewerProtocolPolicy: redirect-to-https
          CachePolicyId: !Ref ApiCachePolicy
        Enabled: true
`);

      template.resourceCountIs("AWS::CloudFront::CachePolicy", 1);
      template.resourceCountIs("AWS::CloudFront::Distribution", 1);
      template.hasOutput("DistributionApiDistributionDomainName", {});
    });

    test("creates a Distribution with OriginRequestPolicy referenced via !Ref", () => {
      const { template } = buildDefinitionFromYaml(`
AWSTemplateFormatVersion: "2010-09-09"
Metadata:
  yamlcdk:
    service: cf-origin-request
Resources:
  AllViewerPolicy:
    Type: AWS::CloudFront::OriginRequestPolicy
    Properties:
      OriginRequestPolicyConfig:
        Name: all-viewer
        HeadersConfig:
          HeaderBehavior: allViewer
        CookiesConfig:
          CookieBehavior: none
        QueryStringsConfig:
          QueryStringBehavior: none
  WebDistribution:
    Type: AWS::CloudFront::Distribution
    Properties:
      DistributionConfig:
        Origins:
          - Id: webOrigin
            DomainName: example.com
            CustomOriginConfig:
              HTTPSPort: 443
              OriginProtocolPolicy: https-only
        DefaultCacheBehavior:
          TargetOriginId: webOrigin
          ViewerProtocolPolicy: redirect-to-https
          OriginRequestPolicyId: !Ref AllViewerPolicy
        Enabled: true
`);

      template.resourceCountIs("AWS::CloudFront::OriginRequestPolicy", 1);
      template.resourceCountIs("AWS::CloudFront::Distribution", 1);
    });

    test("creates a Distribution with additional cache behaviors", () => {
      const { template } = buildDefinitionFromYaml(`
AWSTemplateFormatVersion: "2010-09-09"
Metadata:
  yamlcdk:
    service: cf-additional-behaviors
Resources:
  WebDistribution:
    Type: AWS::CloudFront::Distribution
    Properties:
      DistributionConfig:
        Origins:
          - Id: webOrigin
            DomainName: example.com
        DefaultCacheBehavior:
          TargetOriginId: webOrigin
          ViewerProtocolPolicy: redirect-to-https
        CacheBehaviors:
          - PathPattern: /api/*
            TargetOriginId: webOrigin
            ViewerProtocolPolicy: redirect-to-https
            Compress: true
        Enabled: true
`);

      template.resourceCountIs("AWS::CloudFront::Distribution", 1);
    });
  });
});
