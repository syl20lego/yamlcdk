import { describe, expect, test } from "vitest";
import { buildDefinitionFromYaml } from "../test-utils/e2e.js";

describe("cross-format compatibility", () => {
  test("yamlcdk/serverless/cloudformation produce equivalent canonical SQS wiring", () => {
    const yamlcdk = buildDefinitionFromYaml(`
service: demo
functions:
  worker:
    handler: src/worker.handler
    build:
      mode: none
    events:
      sqs:
        - queue: Jobs
          batchSize: 5
messaging:
  sqs:
    Jobs: {}
`);

    const serverless = buildDefinitionFromYaml(
      `
service: demo
provider:
  name: aws
functions:
  worker:
    handler: src/worker.handler
    events:
      - sqs:
          arn: !GetAtt Jobs.Arn
          batchSize: 5
resources:
  Resources:
    Jobs:
      Type: AWS::SQS::Queue
`,
      "serverless.yml",
    );

    const cloudformation = buildDefinitionFromYaml(
      `
AWSTemplateFormatVersion: "2010-09-09"
Metadata:
  yamlcdk:
    service: demo
Resources:
  WorkerFunction:
    Type: AWS::Lambda::Function
    Properties:
      Handler: src/worker.handler
  Jobs:
    Type: AWS::SQS::Queue
  JobsMapping:
    Type: AWS::Lambda::EventSourceMapping
    Properties:
      FunctionName: !Ref WorkerFunction
      EventSourceArn: !GetAtt Jobs.Arn
      BatchSize: 5
`,
      "template.yml",
    );

    expect(yamlcdk.model.functions.worker.events).toEqual([
      { type: "sqs", queue: "Jobs", batchSize: 5 },
    ]);
    expect(serverless.model.functions.worker.events).toEqual(
      yamlcdk.model.functions.worker.events,
    );
    expect(cloudformation.model.functions.WorkerFunction.events).toEqual(
      yamlcdk.model.functions.worker.events,
    );

    yamlcdk.template.hasResourceProperties("AWS::Lambda::EventSourceMapping", {
      BatchSize: 5,
    });
    serverless.template.hasResourceProperties("AWS::Lambda::EventSourceMapping", {
      BatchSize: 5,
    });
    cloudformation.template.hasResourceProperties(
      "AWS::Lambda::EventSourceMapping",
      { BatchSize: 5 },
    );
  });
});
