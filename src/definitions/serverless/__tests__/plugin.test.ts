import { describe, expect, test } from "vitest";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { definitionRegistry } from "../../registry.js";
import { writeTmpYaml } from "../../test-utils/e2e.js";
import { parseCfnYaml } from "../../cloudformation/index.js";
import { buildApp } from "../../../compiler/stack-builder.js";
import {
  adaptServerlessConfig,
  resolveServerlessVariables,
  serverlessDefinitionPlugin,
  toServerlessFunctionLogicalId,
} from "../index.js";
import {
  S3_CONFIG,
  SNS_CONFIG,
  SQS_CONFIG,
} from "../../../compiler/plugins/native-domain-configs.js";

describe("serverless definition plugin", () => {
  test("formatName is serverless", () => {
    expect(serverlessDefinitionPlugin.formatName).toBe("serverless");
  });

  test("canLoad matches serverless files and rejects non-YAML files", () => {
    const serverlessPath = writeTmpYaml(
      "service: demo\nprovider:\n  name: aws\nfunctions: {}\n",
      "serverless.yml",
    );
    const otherPath = writeTmpYaml('{"service":"demo"}', "serverless.json");

    expect(serverlessDefinitionPlugin.canLoad(serverlessPath)).toBe(true);
    expect(serverlessDefinitionPlugin.canLoad(otherPath)).toBe(false);
  });

  test("generateStarter returns valid Serverless YAML content", () => {
    const content = serverlessDefinitionPlugin.generateStarter!();
    expect(content).toContain("service:");
    expect(content).toContain("provider:");
    expect(content).toContain("name: aws");
    expect(content).toContain("resources:");
  });
});

describe("resolveServerlessVariables", () => {
  test("resolves self/sls/aws variables, fallbacks, and leaves Fn::Sub placeholders intact", () => {
    const resolved = resolveServerlessVariables(
      parseCfnYaml(`
service: demo
provider:
  name: aws
  stage: \${opt:stage, 'prod'}
  region: us-east-1
custom:
  label: \${self:service}-\${sls:stage}-\${aws:region}
resources:
  Outputs:
    DemoOutput:
      Value: !Sub arn:\${AWS::Region}:\${self:service}
`),
    ) as Record<string, unknown>;

    const custom = resolved.custom as Record<string, unknown>;
    const resources = resolved.resources as Record<string, unknown>;
    const outputs = (resources.Outputs as Record<string, unknown>).DemoOutput as Record<
      string,
      unknown
    >;

    expect((resolved.provider as Record<string, unknown>).stage).toBe("prod");
    expect(custom.label).toBe("demo-prod-us-east-1");
    expect(outputs.Value).toEqual({ "Fn::Sub": "arn:${AWS::Region}:demo" });
  });

  test("resolves nested ${file(...):...} variables across sibling YAML files", () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "yamlcdk-serverless-vars-"));
    const serverlessPath = path.join(dir, "serverless.yml");

    fs.writeFileSync(
      serverlessPath,
      `
service: demo
provider:
  name: aws
  region: \${self:custom.global.REGION}
custom:
  global: \${file(./global.yml):custom.global}
functions:
  hello:
    handler: src/hello.handler
`,
      "utf8",
    );

    fs.writeFileSync(
      path.join(dir, "global.yml"),
      `
custom:
  global:
    ENVIRONMENT: dev
    REGION: \${file(./\${self:custom.global.ENVIRONMENT}.env.yml):\${self:custom.global.ENVIRONMENT}.REGION}
`,
      "utf8",
    );

    fs.writeFileSync(
      path.join(dir, "dev.env.yml"),
      `
dev:
  REGION: ca-central-1
`,
      "utf8",
    );

    const model = serverlessDefinitionPlugin.load(serverlessPath);
    expect(model.provider.region).toBe("ca-central-1");
  });

  test("supports fallback alternatives when a file variable cannot be resolved", () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "yamlcdk-serverless-fallback-"));
    const serverlessPath = path.join(dir, "serverless.yml");

    fs.writeFileSync(
      serverlessPath,
      `
service: demo
provider:
  name: aws
  region: \${self:custom.global.REGION}
custom:
  global: \${file(./global.yml):custom.global}
functions:
  hello:
    handler: src/hello.handler
`,
      "utf8",
    );

    fs.writeFileSync(
      path.join(dir, "global.yml"),
      `
custom:
  global:
    ENVIRONMENT: qa
    REGION: \${file(./\${self:custom.global.ENVIRONMENT}.env.yml):\${self:custom.global.ENVIRONMENT}.REGION, 'us-east-1'}
`,
      "utf8",
    );

    const model = serverlessDefinitionPlugin.load(serverlessPath);
    expect(model.provider.region).toBe("us-east-1");
  });
});

describe("adaptServerlessConfig", () => {
  test("adapts supported top-level Serverless fields into the canonical model", () => {
    const model = adaptServerlessConfig(
      parseCfnYaml(`
service: demo
provider:
  name: aws
  stage: prod
  region: eu-west-1
  runtime: nodejs22.x
  timeout: 20
  memorySize: 512
functions:
  hello:
    handler: src/hello.handler
    environment:
      STAGE: \${sls:stage}
    url:
      cors: true
    events:
      - http: GET hello
      - httpApi:
          method: post
          path: /hello
      - schedule: rate(5 minutes)
      - s3: uploads
      - sns: dispatch
`),
      "serverless.yml",
    );

    expect(model.service).toBe("demo");
    expect(model.stackName).toBe("demo-prod");
    expect(model.provider.stage).toBe("prod");
    expect(model.provider.region).toBe("eu-west-1");
    expect(model.functions.hello.runtime).toBe("nodejs22.x");
    expect(model.functions.hello.timeout).toBe(20);
    expect(model.functions.hello.memorySize).toBe(512);
    expect(model.functions.hello.environment?.STAGE).toBe("prod");
    expect(model.functions.hello.url).toEqual({
      authType: "NONE",
      invokeMode: "BUFFERED",
      cors: {
        allowHeaders: [
          "Content-Type",
          "X-Amz-Date",
          "Authorization",
          "X-Api-Key",
          "X-Amz-Security-Token",
        ],
        allowedMethods: ["*"],
        allowOrigins: ["*"],
      },
    });
    expect(model.functions.hello.events.map((event) => event.type).sort()).toEqual([
      "eventbridge",
      "http",
      "rest",
      "s3",
      "sns",
    ]);
    expect(model.domainConfigs.require(S3_CONFIG).buckets.uploads).toEqual({});
    expect(model.domainConfigs.require(SNS_CONFIG).topics.dispatch).toEqual({});
  });

  test("maps deploymentRole and deploymentBucket into canonical deployment config", () => {
    const model = adaptServerlessConfig(
      parseCfnYaml(`
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
`),
      "serverless.yml",
    );

    expect(model.provider.deployment).toEqual({
      cloudFormationExecutionRoleArn:
        "arn:aws:iam::638914547607:role/AldoDefaultCFNRole",
      fileAssetsBucketName: "aldo-serverless-build-omni-hybris-lab-dev-us-east-1",
    });
  });

  test("uses non-bootstrap synthesizer behavior for mapped Serverless deployment settings", () => {
    const model = adaptServerlessConfig(
      parseCfnYaml(`
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
`),
      "serverless.yml",
    );

    const { app, stack } = buildApp(model);
    const assembly = app.synth();
    const stackArtifact = assembly.getStackArtifact(model.stackName);
    const rules =
      (stackArtifact.template as { Rules?: Record<string, unknown> }).Rules ?? {};

    expect(stack.synthesizer.constructor.name).toBe(
      "CliCredentialsStackSynthesizer",
    );
    expect(Object.keys(rules)).toHaveLength(0);
  });

  test("reuses CloudFormation adaptation for resources.Resources and merges onto top-level functions", () => {
    const model = adaptServerlessConfig(
      parseCfnYaml(`
service: demo
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
`),
      "serverless.yml",
    );

    expect(toServerlessFunctionLogicalId("worker")).toBe("WorkerLambdaFunction");
    expect(model.functions.worker.url?.authType).toBe("NONE");
    expect(model.functions.worker.events).toContainEqual({
      type: "sqs",
      queue: "JobsQueue",
      batchSize: 5,
    });
    expect(model.domainConfigs.require(SQS_CONFIG).queues.JobsQueue.visibilityTimeout).toBe(
      45,
    );
  });

  test("rejects custom resources that override generated function logical ids", () => {
    expect(() =>
      adaptServerlessConfig(
        parseCfnYaml(`
service: demo
provider:
  name: aws
functions:
  worker:
    handler: src/worker.handler
resources:
  Resources:
    WorkerLambdaFunction:
      Type: AWS::Lambda::Function
      Properties:
        Handler: index.handler
        Runtime: nodejs20.x
`),
        "serverless.yml",
      ),
    ).toThrow(/conflicts with a Serverless-generated function logical ID/);
  });
});

describe("definition registry", () => {
  test("resolves serverless.yml to the serverless plugin", () => {
    const serverlessPath = writeTmpYaml(
      "service: demo\nprovider:\n  name: aws\nfunctions: {}\n",
      "serverless.yml",
    );
    const plugin = definitionRegistry.resolve(serverlessPath);
    expect(plugin.formatName).toBe("serverless");
  });
});
