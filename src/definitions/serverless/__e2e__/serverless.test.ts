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
  });
});
