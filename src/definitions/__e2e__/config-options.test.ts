import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { describe, expect, test } from "vitest";
import { serverlessDefinitionPlugin } from "../serverless/index.js";
import { yamlcdkDefinitionPlugin } from "../yamlcdk/index.js";
import { cloudformationDefinitionPlugin } from "../cloudformation/index.js";

function makeTmpDir(): string {
  return fs.mkdtempSync(path.join(os.tmpdir(), "yamlcdk-config-e2e-"));
}

function writeFile(dir: string, name: string, content: string): string {
  const filePath = path.join(dir, name);
  fs.writeFileSync(filePath, content.trimStart(), "utf8");
  return filePath;
}

function withEnv(
  vars: Record<string, string>,
  fn: () => void,
): void {
  const saved: Record<string, string | undefined> = {};
  for (const key of Object.keys(vars)) {
    saved[key] = process.env[key];
    process.env[key] = vars[key];
  }
  try {
    fn();
  } finally {
    for (const [key, prev] of Object.entries(saved)) {
      if (prev === undefined) delete process.env[key];
      else process.env[key] = prev;
    }
  }
}

describe("configuration options e2e", () => {
  describe("${env:...} variable source", () => {
    test("resolves env variables through the serverless plugin", () => {
      const dir = makeTmpDir();
      const filePath = writeFile(dir, "serverless.yml", `
service: demo
provider:
  name: aws
  stage: \${env:YAMLCDK_E2E_STAGE}
  region: us-east-1
functions:
  hello:
    handler: src/hello.handler
`);

      withEnv({ YAMLCDK_E2E_STAGE: "staging" }, () => {
        const model = serverlessDefinitionPlugin.load(filePath);
        expect(model.provider.stage).toBe("staging");
      });
      fs.rmSync(dir, { recursive: true, force: true });
    });

    test("resolves env variables through the yamlcdk plugin", () => {
      const dir = makeTmpDir();
      const filePath = writeFile(dir, "yamlcdk.yml", `
service: demo
provider:
  region: \${env:YAMLCDK_E2E_REGION}
functions:
  hello:
    handler: src/hello.handler
    build:
      mode: none
`);

      withEnv({ YAMLCDK_E2E_REGION: "ap-southeast-1" }, () => {
        const model = yamlcdkDefinitionPlugin.load(filePath);
        expect(model.provider.region).toBe("ap-southeast-1");
      });
      fs.rmSync(dir, { recursive: true, force: true });
    });

    test("resolves env variables through the cloudformation plugin", () => {
      const dir = makeTmpDir();
      const filePath = writeFile(dir, "template.yml", `
AWSTemplateFormatVersion: "2010-09-09"
Metadata:
  yamlcdk:
    service: demo
    stage: \${env:YAMLCDK_E2E_CFN_STAGE}
Resources:
  HelloFunction:
    Type: AWS::Lambda::Function
    Properties:
      Handler: src/hello.handler
`);

      withEnv({ YAMLCDK_E2E_CFN_STAGE: "qa" }, () => {
        const model = cloudformationDefinitionPlugin.load(filePath);
        expect(model.provider.stage).toBe("qa");
      });
      fs.rmSync(dir, { recursive: true, force: true });
    });

    test("falls back to literal when env var is missing", () => {
      delete process.env.YAMLCDK_E2E_MISSING;
      const dir = makeTmpDir();
      const filePath = writeFile(dir, "serverless.yml", `
service: demo
provider:
  name: aws
  stage: \${env:YAMLCDK_E2E_MISSING, 'fallback-stage'}
functions:
  hello:
    handler: src/hello.handler
`);

      const model = serverlessDefinitionPlugin.load(filePath);
      expect(model.provider.stage).toBe("fallback-stage");
      fs.rmSync(dir, { recursive: true, force: true });
    });
  });

  describe("${opt:...} variable source", () => {
    test("resolves opt variables passed through plugin.load options", () => {
      const dir = makeTmpDir();
      const filePath = writeFile(dir, "serverless.yml", `
service: demo
provider:
  name: aws
  stage: \${opt:stage}
functions:
  hello:
    handler: src/hello.handler
`);

      const model = serverlessDefinitionPlugin.load(filePath, { opt: { stage: "production" } });
      expect(model.provider.stage).toBe("production");
      fs.rmSync(dir, { recursive: true, force: true });
    });

    test("falls back to literal when opt is not provided", () => {
      const dir = makeTmpDir();
      const filePath = writeFile(dir, "serverless.yml", `
service: demo
provider:
  name: aws
  stage: \${opt:stage, 'dev'}
functions:
  hello:
    handler: src/hello.handler
`);

      const model = serverlessDefinitionPlugin.load(filePath);
      expect(model.provider.stage).toBe("dev");
      fs.rmSync(dir, { recursive: true, force: true });
    });
  });

  describe("${file(...):...} variable source", () => {
    test("resolves file references across YAML files", () => {
      const dir = makeTmpDir();
      writeFile(dir, "shared.yml", `
config:
  region: eu-central-1
  stage: prod
`);
      const filePath = writeFile(dir, "serverless.yml", `
service: demo
provider:
  name: aws
  stage: \${file(./shared.yml):config.stage}
  region: \${file(./shared.yml):config.region}
functions:
  hello:
    handler: src/hello.handler
`);

      const model = serverlessDefinitionPlugin.load(filePath);
      expect(model.provider.stage).toBe("prod");
      expect(model.provider.region).toBe("eu-central-1");
      fs.rmSync(dir, { recursive: true, force: true });
    });
  });

  describe(".env file loading", () => {
    test("loads variables from .env file for ${env:...} resolution", () => {
      delete process.env.YAMLCDK_DOTENV_REGION;
      const dir = makeTmpDir();
      writeFile(dir, ".env", `YAMLCDK_DOTENV_REGION=ca-central-1`);
      const filePath = writeFile(dir, "serverless.yml", `
service: demo
provider:
  name: aws
  region: \${env:YAMLCDK_DOTENV_REGION}
functions:
  hello:
    handler: src/hello.handler
`);

      try {
        const model = serverlessDefinitionPlugin.load(filePath);
        expect(model.provider.region).toBe("ca-central-1");
      } finally {
        delete process.env.YAMLCDK_DOTENV_REGION;
        fs.rmSync(dir, { recursive: true, force: true });
      }
    });

    test(".env.{stage} takes priority over .env", () => {
      delete process.env.YAMLCDK_DOTENV_PRIORITY;
      const dir = makeTmpDir();
      writeFile(dir, ".env", `YAMLCDK_DOTENV_PRIORITY=from-base`);
      writeFile(dir, ".env.staging", `YAMLCDK_DOTENV_PRIORITY=from-staging`);
      const filePath = writeFile(dir, "serverless.yml", `
service: demo
provider:
  name: aws
  stage: \${env:YAMLCDK_DOTENV_PRIORITY}
functions:
  hello:
    handler: src/hello.handler
`);

      try {
        const model = serverlessDefinitionPlugin.load(filePath, {
          opt: { stage: "staging" },
        });
        expect(model.provider.stage).toBe("from-staging");
      } finally {
        delete process.env.YAMLCDK_DOTENV_PRIORITY;
        fs.rmSync(dir, { recursive: true, force: true });
      }
    });
  });

  describe("cross-file self: references", () => {
    test("resolves serverless → global → env file chain without circular error", () => {
      const dir = makeTmpDir();
      writeFile(dir, "global.yml", [
        "custom:",
        "  global:",
        "    STAGE: ${opt:stage, self:provider.stage}",
        "    ENV: ${file(./${self:custom.global.STAGE}.env.yml):${self:custom.global.STAGE}.ENV}",
        "    REGION: ${file(./${self:custom.global.ENV}.env.yml):${self:custom.global.ENV}.REGION}",
      ].join("\n"));
      writeFile(dir, "dev.env.yml", [
        "dev:",
        "  ENV: dev",
        "  REGION: us-east-1",
      ].join("\n"));
      const filePath = writeFile(dir, "serverless.yml", [
        "service: demo",
        "custom:",
        "  global: ${file(./global.yml):custom.global}",
        "provider:",
        "  name: aws",
        "  stage: ${env:YAMLCDK_E2E_XFILE_STAGE}",
        "  region: ${self:custom.global.REGION}",
        "functions:",
        "  hello:",
        "    handler: src/hello.handler",
      ].join("\n"));

      withEnv({ YAMLCDK_E2E_XFILE_STAGE: "dev" }, () => {
        const model = serverlessDefinitionPlugin.load(filePath);
        expect(model.provider.stage).toBe("dev");
        expect(model.provider.region).toBe("us-east-1");
      });
      fs.rmSync(dir, { recursive: true, force: true });
    });
  });

  describe("combined variable sources", () => {
    test("resolves env, opt, self, sls, file, and aws sources in the same config", () => {
      const dir = makeTmpDir();
      writeFile(dir, "shared.yml", `
values:
  timeout: 30
`);
      const filePath = writeFile(dir, "serverless.yml", `
service: combined-demo
provider:
  name: aws
  stage: \${opt:stage}
  region: \${env:YAMLCDK_E2E_COMBO_REGION}
custom:
  timeout: \${file(./shared.yml):values.timeout}
  label: \${self:service}-\${sls:stage}
  awsRegion: \${aws:region}
functions:
  hello:
    handler: src/hello.handler
    timeout: \${self:custom.timeout}
`);

      withEnv({ YAMLCDK_E2E_COMBO_REGION: "ap-northeast-1" }, () => {
        const model = serverlessDefinitionPlugin.load(filePath, {
          opt: { stage: "test" },
        });
        expect(model.provider.stage).toBe("test");
        expect(model.provider.region).toBe("ap-northeast-1");
        expect(model.functions.hello.timeout).toBe(30);
      });
      fs.rmSync(dir, { recursive: true, force: true });
    });
  });
});
