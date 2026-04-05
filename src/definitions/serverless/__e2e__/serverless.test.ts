import { Match } from "aws-cdk-lib/assertions";
import { describe, expect, test } from "vitest";
import {
    buildDefinitionFromYaml,
    firstResourceOfType,
    type ResourceDefinition, writeTmpYaml,
} from "../../test-utils/e2e.js";
import {definitionRegistry} from "../../registry.js";

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
});
