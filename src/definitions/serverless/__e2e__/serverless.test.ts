import { Match } from "aws-cdk-lib/assertions";
import { describe, expect, test } from "vitest";
import {
  buildDefinitionFromYaml,
  firstResourceOfType,
  type ResourceDefinition,
  writeTmpYaml,
} from "../../test-utils/e2e.js";
import { definitionRegistry } from "../../registry.js";

describe("serverless definition e2e", () => {
  describe("definition registry", () => {
    test("resolves serverless.yml files to serverless plugin", () => {
      const serverlessPath = writeTmpYaml(
        "service: my-service\nprovider:\n  name: aws\nfunctions: {}\n",
        "serverless.yml",
      );
      const plugin = definitionRegistry.resolve(serverlessPath);
      expect(plugin.formatName).toBe("serverless");
    });
  });

  test("synthesizes supported top-level Serverless functions, URLs, and API events", () => {
    const { plugin, model, template } = buildDefinitionFromYaml(
      `
service: demo
provider:
  name: aws
  stage: \${opt:stage, 'prod'}
  region: eu-west-1
  runtime: nodejs22.x
functions:
  hello:
    handler: src/hello.handler
    url:
      cors: true
    events:
      - http: GET hello
      - httpApi: POST /hello
      - schedule: rate(5 minutes)
`,
      "serverless.yml",
    );

    expect(plugin.formatName).toBe("serverless");
    expect(model.provider.stage).toBe("prod");
    expect(model.provider.region).toBe("eu-west-1");
    template.resourceCountIs("AWS::Lambda::Function", 1);
    template.resourceCountIs("AWS::Lambda::Url", 1);
    template.resourceCountIs("AWS::ApiGateway::RestApi", 1);
    template.resourceCountIs("AWS::ApiGatewayV2::Api", 1);
    template.resourceCountIs("AWS::Events::Rule", 1);
  });

  test("synthesizes eventBridge with custom eventBus ARN", () => {
    const busArn = "arn:aws:events:us-east-1:123456789012:event-bus/marketing";
    const { template } = buildDefinitionFromYaml(
      `
service: demo
provider:
  name: aws
functions:
  worker:
    handler: src/worker.handler
    events:
      - eventBridge:
          eventBus: ${busArn}
          pattern:
            source:
              - marketing
            detail-type:
              - SEND_EMAIL
`,
      "serverless.yml",
    );

    template.resourceCountIs("AWS::Events::Rule", 1);
    template.hasResourceProperties(
      "AWS::Events::Rule",
      Match.objectLike({
        EventBusName: "marketing",
        EventPattern: {
          source: ["marketing"],
          "detail-type": ["SEND_EMAIL"],
        },
      }),
    );
  });

  test("supports intrinsic external SQS queue ARN event mappings", () => {
    const exportName = "shared-jobs-queue-arn";
    const { template } = buildDefinitionFromYaml(
      `
service: demo
provider:
  name: aws
functions:
  worker:
    handler: src/worker.handler
    events:
      - sqs:
          arn: !ImportValue ${exportName}
          batchSize: 5
`,
      "serverless.yml",
    );

    template.resourceCountIs("AWS::SQS::Queue", 0);
    template.hasResourceProperties(
      "AWS::Lambda::EventSourceMapping",
      Match.objectLike({
        EventSourceArn: { "Fn::ImportValue": exportName },
        BatchSize: 5,
      }),
    );
  });

  test("reuses resources.Resources through the CloudFormation adapter path", () => {
    const { plugin, model, template } = buildDefinitionFromYaml(
      `
service: merge-demo
provider:
  name: aws
functions:
  worker:
    handler: src/worker.handler
    events:
      - sqs:
          arn: !GetAtt JobsQueue.Arn
          batchSize: 5
resources:
  Resources:
    JobsQueue:
      Type: AWS::SQS::Queue
      Properties:
        VisibilityTimeout: 45
    WorkerFunctionUrl:
      Type: AWS::Lambda::Url
      Properties:
        TargetFunctionArn: !GetAtt WorkerLambdaFunction.Arn
        AuthType: NONE
`,
      "serverless.yml",
    );

    expect(plugin.formatName).toBe("serverless");
    expect(model.functions.worker.url?.authType).toBe("NONE");
    template.hasResourceProperties(
      "AWS::SQS::Queue",
      Match.objectLike({
        VisibilityTimeout: 45,
      }),
    );
    template.hasResourceProperties(
      "AWS::Lambda::EventSourceMapping",
      Match.objectLike({
        BatchSize: 5,
      }),
    );

    const functionUrl = firstResourceOfType<ResourceDefinition>(
      template,
      "AWS::Lambda::Url",
    );
    expect(functionUrl?.Properties?.AuthType).toBe("NONE");
  });

  test("preserves extended SNS topic properties from resources.Resources", () => {
    const { template } = buildDefinitionFromYaml(
      `
service: sns-extended
provider:
  name: aws
functions:
  worker:
    handler: src/worker.handler
resources:
  Resources:
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
        Endpoint: !GetAtt WorkerLambdaFunction.Arn
        FilterPolicy:
          severity:
            - high
        RawMessageDelivery: true
`,
      "serverless.yml",
    );

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

  test("maps Serverless deployment settings so bootstrap rules are not synthesized", () => {
    const { model, stack } = buildDefinitionFromYaml(
      `
service: demo
provider:
  name: aws
  stage: \${opt:stage, 'dev'}
  region: us-east-1
  runtime: nodejs20.x
  iam:
    deploymentRole: arn:aws:iam::638914547607:role/AldoDefaultCFNRole
  deploymentBucket:
    name: aldo-serverless-build-omni-hybris-lab-dev-us-east-1
functions:
  hello:
    handler: src/hello.handler
`,
      "serverless.yml",
    );

    const assembly = stack.node.root.synth();
    const stackArtifact = assembly.getStackArtifact(model.stackName);
    const rules =
      (stackArtifact.template as { Rules?: Record<string, unknown> }).Rules ?? {};

    expect(model.provider.deployment).toEqual({
      cloudFormationExecutionRoleArn:
        "arn:aws:iam::638914547607:role/AldoDefaultCFNRole",
      fileAssetsBucketName: "aldo-serverless-build-omni-hybris-lab-dev-us-east-1",
    });
    expect(stack.synthesizer.constructor.name).toBe(
      "CliCredentialsStackSynthesizer",
    );
    expect(Object.keys(rules)).toHaveLength(0);
  });

  test("maps Serverless provider.deployment.requireBootstrap so bootstrap rule can be skipped explicitly", () => {
    const { model, stack } = buildDefinitionFromYaml(
      `
service: demo
provider:
  name: aws
  region: us-east-1
  deployment:
    requireBootstrap: false
functions:
  hello:
    handler: src/hello.handler
`,
      "serverless.yml",
    );

    const assembly = stack.node.root.synth();
    const stackArtifact = assembly.getStackArtifact(model.stackName);
    const rules =
      (stackArtifact.template as { Rules?: Record<string, unknown> }).Rules ?? {};

    expect(model.provider.deployment).toEqual({
      requireBootstrap: false,
    });
    expect(stack.synthesizer.constructor.name).toBe("DefaultStackSynthesizer");
    expect(Object.keys(rules)).toHaveLength(0);
  });

  describe("CloudFront resources (under resources.Resources)", () => {
    test("creates a CachePolicy from AWS::CloudFront::CachePolicy in resources", () => {
      const { template } = buildDefinitionFromYaml(
        `
service: demo
provider:
  name: aws
  stage: dev
  region: us-east-1
resources:
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
`,
        "serverless.yml",
      );

      template.resourceCountIs("AWS::CloudFront::CachePolicy", 1);
    });

    test("creates an OriginRequestPolicy from AWS::CloudFront::OriginRequestPolicy in resources", () => {
      const { template } = buildDefinitionFromYaml(
        `
service: demo
provider:
  name: aws
  stage: dev
  region: us-east-1
resources:
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
`,
        "serverless.yml",
      );

      template.resourceCountIs("AWS::CloudFront::OriginRequestPolicy", 1);
    });

    test("creates a Distribution referencing a CachePolicy via !Ref in resources", () => {
      const { template } = buildDefinitionFromYaml(
        `
service: demo
provider:
  name: aws
  stage: dev
  region: us-east-1
resources:
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
`,
        "serverless.yml",
      );

      template.resourceCountIs("AWS::CloudFront::CachePolicy", 1);
      template.resourceCountIs("AWS::CloudFront::Distribution", 1);
      template.hasOutput("DistributionApiDistributionDomainName", {});
    });

    test("preserves intrinsic DomainName for CloudFront origins", () => {
      const { template } = buildDefinitionFromYaml(
        `
service: demo
provider:
  name: aws
  stage: dev
  region: us-east-1
resources:
  Resources:
    ApiDistribution:
      Type: AWS::CloudFront::Distribution
      Properties:
        DistributionConfig:
          Origins:
            - Id: apiOrigin
              DomainName:
                Fn::Select:
                  - "2"
                  - Fn::Split:
                      - "/"
                      - Fn::ImportValue: external-endpoint
              CustomOriginConfig:
                HTTPSPort: 443
                OriginProtocolPolicy: https-only
          DefaultCacheBehavior:
            TargetOriginId: apiOrigin
            ViewerProtocolPolicy: redirect-to-https
          Enabled: true
`,
        "serverless.yml",
      );

      template.hasResourceProperties(
        "AWS::CloudFront::Distribution",
        Match.objectLike({
          DistributionConfig: Match.objectLike({
            Origins: Match.arrayWith([
              Match.objectLike({
                DomainName: {
                  "Fn::Select": [
                    "2",
                    {
                      "Fn::Split": [
                        "/",
                        { "Fn::ImportValue": "external-endpoint" },
                      ],
                    },
                  ],
                },
              }),
            ]),
          }),
        }),
      );
    });
  });

  describe("passthrough outputs (resources.Outputs)", () => {
    test("emits user-defined outputs with intrinsic function values and exports", () => {
      const { template } = buildDefinitionFromYaml(
        `
service: demo
provider:
  name: aws
  stage: dev
  region: us-east-1
functions:
  hello:
    handler: src/hello.handler
resources:
  Outputs:
    ServiceEndpoint:
      Value: !GetAtt HelloLambdaFunction.Arn
      Export:
        Name: demo-service-endpoint
    StaticOutput:
      Value: hello-world
      Description: A simple static output
`,
        "serverless.yml",
      );

      template.hasOutput("ServiceEndpoint", {
        Value: { "Fn::GetAtt": ["HelloLambdaFunction", "Arn"] },
        Export: { Name: "demo-service-endpoint" },
      });
      template.hasOutput("StaticOutput", {
        Value: "hello-world",
        Description: "A simple static output",
      });
    });

    test("auto-fills output Value when only Export is defined and REST API exists", () => {
      const { template } = buildDefinitionFromYaml(
        `
service: demo
provider:
  name: aws
  stage: dev
  region: us-east-1
functions:
  hello:
    handler: src/hello.handler
    events:
      - http:
          method: GET
          path: /hello
resources:
  Outputs:
    ServiceEndpoint:
      Export:
        Name: demo-service-endpoint
`,
        "serverless.yml",
      );

      const outputs = template.toJSON().Outputs;
      expect(outputs.ServiceEndpoint).toBeDefined();
      expect(outputs.ServiceEndpoint.Export.Name).toBe("demo-service-endpoint");
      expect(outputs.ServiceEndpoint.Value).toBeDefined();
    });

    test("remaps output Fn::GetAtt source logical IDs for managed resources", () => {
      const { template } = buildDefinitionFromYaml(
        `
service: demo
provider:
  name: aws
  stage: dev
  region: us-east-1
functions:
  hello:
    handler: src/hello.handler
resources:
  Resources:
    EmailReminderSyncQueue:
      Type: AWS::SQS::Queue
  Outputs:
    EmailReminderSyncQueue:
      Value: !GetAtt EmailReminderSyncQueue.Arn
`,
        "serverless.yml",
      );

      const outputs = template.toJSON().Outputs;
      const value = outputs.EmailReminderSyncQueue.Value as { "Fn::GetAtt": [string, string] };
      expect(value["Fn::GetAtt"][0]).toContain("QueueEmailReminderSyncQueue");
      expect(value["Fn::GetAtt"][0]).not.toBe("EmailReminderSyncQueue");
      expect(value["Fn::GetAtt"][1]).toBe("Arn");
    });

    test("remaps output Ref source logical IDs for managed resources", () => {
      const { template } = buildDefinitionFromYaml(
        `
service: demo
provider:
  name: aws
  stage: dev
  region: us-east-1
functions:
  hello:
    handler: src/hello.handler
resources:
  Resources:
    EmailReminderSyncQueue:
      Type: AWS::SQS::Queue
  Outputs:
    EmailReminderSyncQueue:
      Value: !Ref EmailReminderSyncQueue
`,
        "serverless.yml",
      );

      const outputs = template.toJSON().Outputs;
      const value = outputs.EmailReminderSyncQueue.Value as { Ref: string };
      expect(value.Ref).toContain("QueueEmailReminderSyncQueue");
      expect(value.Ref).not.toBe("EmailReminderSyncQueue");
    });
  });
});
