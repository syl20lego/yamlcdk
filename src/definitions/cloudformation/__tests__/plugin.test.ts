import { describe, expect, test } from "vitest";
import fs from "node:fs";
import path from "node:path";
import os from "node:os";
import { cloudformationDefinitionPlugin } from "../plugin.js";
import { definitionRegistry } from "../../registry.js";
import { writeTmpYaml } from "../../test-utils/e2e.js";
import { S3_CONFIG } from "../../../domains/s3/model.js";
import { DYNAMODB_CONFIG } from "../../../domains/dynamodb/model.js";
import { SQS_CONFIG } from "../../../domains/sqs/model.js";
import { SNS_CONFIG } from "../../../domains/sns/model.js";

describe("cloudformation definition plugin", () => {
  test("formatName is cloudformation", () => {
    expect(cloudformationDefinitionPlugin.formatName).toBe("cloudformation");
  });

  test("canLoad matches CloudFormation templates", () => {
    const cfnPath = writeTmpYaml(
      'AWSTemplateFormatVersion: "2010-09-09"\nResources: {}',
    );
    expect(cloudformationDefinitionPlugin.canLoad(cfnPath)).toBe(true);
  });

  test("canLoad matches templates with AWS:: resource types", () => {
    const cfnPath = writeTmpYaml(
      "Resources:\n  MyFunc:\n    Type: AWS::Lambda::Function",
    );
    expect(cloudformationDefinitionPlugin.canLoad(cfnPath)).toBe(true);
  });

  test("canLoad rejects yamlcdk format", () => {
    const yamlcdkPath = writeTmpYaml(
      "service: my-service\nprovider:\n  region: us-east-1\nfunctions: {}",
    );
    expect(cloudformationDefinitionPlugin.canLoad(yamlcdkPath)).toBe(false);
  });

  test("canLoad rejects non-YAML files", () => {
    const jsonPath = writeTmpYaml('{"key": "value"}', "template.json");
    expect(cloudformationDefinitionPlugin.canLoad(jsonPath)).toBe(false);
  });

  test("canLoad rejects serverless templates with provider: aws", () => {
    const serverlessPath = writeTmpYaml(
      "service: legacy-service\nprovider: aws\nfunctions: {}",
    );
    expect(cloudformationDefinitionPlugin.canLoad(serverlessPath)).toBe(false);
  });

  test("canLoad rejects serverless templates with provider.name: aws", () => {
    const serverlessPath = writeTmpYaml(
      "service: legacy-service\nprovider:\n  name: aws\nfunctions: {}",
    );
    expect(cloudformationDefinitionPlugin.canLoad(serverlessPath)).toBe(false);
  });

  test("canLoad accepts mixed templates when AWSTemplateFormatVersion is present", () => {
    const cfnPath = writeTmpYaml(
      'service: legacy-service\nprovider: aws\nAWSTemplateFormatVersion: "2010-09-09"\nResources: {}',
    );
    expect(cloudformationDefinitionPlugin.canLoad(cfnPath)).toBe(true);
  });

  test("generateStarter returns valid CloudFormation template", () => {
    const content = cloudformationDefinitionPlugin.generateStarter!();
    expect(content).toContain("AWSTemplateFormatVersion");
    expect(content).toContain("AWS::Lambda::Function");
    expect(content).toContain("AWS::S3::Bucket");
    expect(content).toContain("Metadata:");
    expect(content).toContain("yamlcdk:");
    expect(content).toContain("service:");
  });

  test("load resolves ${file(...):...} values in Metadata.yamlcdk", () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "yamlcdk-cfn-vars-"));
    const templatePath = path.join(dir, "template.yml");

    fs.writeFileSync(
      templatePath,
      `
AWSTemplateFormatVersion: "2010-09-09"
Metadata:
  yamlcdk:
    service: cfn-demo
    stage: dev
    region: \${file(./global.yml):config.region}
Resources: {}
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

    const model = cloudformationDefinitionPlugin.load(templatePath);
    expect(model.provider.region).toBe("ca-central-1");
  });

  test("load throws when required ${file(...):...} values are missing", () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "yamlcdk-cfn-vars-missing-"));
    const templatePath = path.join(dir, "template.yml");

    fs.writeFileSync(
      templatePath,
      `
AWSTemplateFormatVersion: "2010-09-09"
Metadata:
  yamlcdk:
    service: cfn-demo
    stage: dev
    region: \${file(./missing.yml):config.region}
Resources: {}
`,
      "utf8",
    );

    expect(() => cloudformationDefinitionPlugin.load(templatePath)).toThrow(
      /Unable to resolve variable/,
    );
  });

  test("load resolves ${opt:...} values in Metadata.yamlcdk", () => {
    const templatePath = writeTmpYaml(
      `
AWSTemplateFormatVersion: "2010-09-09"
Metadata:
  yamlcdk:
    service: cfn-demo
    stage: \${opt:stage}
    region: us-east-1
Resources: {}
`,
      "template.yml",
    );

    const model = cloudformationDefinitionPlugin.load(templatePath, {
      opt: { stage: "prod" },
    });
    expect(model.provider.stage).toBe("prod");
    expect(model.stackName).toBe("cfn-demo-prod");
  });

  test("load throws for YAML that parses to a non-object value", () => {
    const templatePath = writeTmpYaml("just-a-string", "template.yml");

    expect(() => cloudformationDefinitionPlugin.load(templatePath)).toThrow(
      /Failed to parse CloudFormation template/,
    );
  });
});

describe("definition registry", () => {
  test("resolves CloudFormation templates to cfn plugin", () => {
    const cfnPath = writeTmpYaml(
      'AWSTemplateFormatVersion: "2010-09-09"\nResources: {}',
    );
    const plugin = definitionRegistry.resolve(cfnPath);
    expect(plugin.formatName).toBe("cloudformation");
  });
});

describe("full CloudFormation file load", () => {
  test("loads example CloudFormation template", () => {
    const examplePath = path.resolve("examples/cloudformation.yml");
    const model = cloudformationDefinitionPlugin.load(examplePath);

    expect(model.service).toBe("demo-api");
    expect(model.provider.stage).toBe("dev");
    expect(model.provider.region).toBe("us-east-1");

    expect(model.functions.HelloFunction).toBeDefined();
    expect(model.functions.ProcessFunction).toBeDefined();

    const s3Config = model.domainConfigs.require(S3_CONFIG);
    expect(s3Config.buckets.UploadsBucket.versioned).toBe(true);

    const dynamoConfig = model.domainConfigs.require(DYNAMODB_CONFIG);
    expect(dynamoConfig.tables.UsersTable.partitionKey.name).toBe("pk");
    expect(dynamoConfig.tables.UsersTable.sortKey?.name).toBe("sk");
    expect(dynamoConfig.tables.UsersTable.stream).toBe(
      "NEW_AND_OLD_IMAGES",
    );

    const sqsConfig = model.domainConfigs.require(SQS_CONFIG);
    expect(sqsConfig.queues.JobsQueue.visibilityTimeout).toBe(30);

    const snsConfig = model.domainConfigs.require(SNS_CONFIG);
    expect(snsConfig.topics.EventsTopic.subscriptions).toHaveLength(1);

    const helloEvents = model.functions.HelloFunction.events;
    const eventTypes = helloEvents.map((e) => e.type).sort();
    expect(eventTypes).toEqual([
      "dynamodb-stream",
      "eventbridge",
      "http",
      "sqs",
    ]);

    const processEvents = model.functions.ProcessFunction.events;
    expect(processEvents).toHaveLength(1);
    expect(processEvents[0].type).toBe("s3");
  });

  test("loads from temp file with default metadata", () => {
    const content = `
AWSTemplateFormatVersion: "2010-09-09"
Resources:
  Worker:
    Type: AWS::Lambda::Function
    Properties:
      Handler: src/worker.handler
`;
    const filePath = writeTmpYaml(content, "my-stack.yml");
    const model = cloudformationDefinitionPlugin.load(filePath);
    expect(model.functions.Worker).toBeDefined();
    expect(model.provider.stage).toBe("dev");
  });
});

