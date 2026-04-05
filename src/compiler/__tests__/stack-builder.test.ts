import { describe, expect, test } from "vitest";
import { buildApp } from "../stack-builder.js";
import { normalizeConfig } from "../../config/normalize.js";
import { validateServiceConfig } from "../../config/schema.js";

describe("compiler", () => {
  test("synthesizes a cross-domain stack with core resources", () => {
    const config = normalizeConfig(
      validateServiceConfig({
        service: "demo",
        provider: {
          s3: {
            cleanupRoleArn: "arn:aws:iam::123456789012:role/MyS3CleanupRole",
          },
        },
        functions: {
          hello: {
            handler: "src/hello.handler",
            build: {
              mode: "none",
            },
            events: {
              http: [{ method: "GET", path: "/hello" }],
              rest: [{ method: "GET", path: "/hello-rest" }],
            },
          },
        },
        storage: {
          s3: { uploads: { autoDeleteObjects: true } },
          dynamodb: {
            users: { partitionKey: { name: "pk", type: "string" } },
          },
        },
        messaging: {
          sqs: { jobs: {} },
          sns: { events: {} },
        },
      }),
    );
    const { app } = buildApp(config);
    const assembly = app.synth();
    const stackArtifact = assembly.getStackArtifact(config.stackName);

    expect(stackArtifact).toBeTruthy();
    expect(Object.keys(stackArtifact.template.Resources).length).toBeGreaterThan(0);
    expect(stackArtifact.template.Outputs).toHaveProperty("HttpApiUrl");
    expect(stackArtifact.template.Outputs).toHaveProperty("RestApiUrl");
  });

  test("applies custom deployment synthesizer settings", () => {
    const config = normalizeConfig(
      validateServiceConfig({
        service: "demo",
        provider: {
          account: "123456789012",
          region: "us-east-1",
          deployment: {
            fileAssetsBucketName: "custom-assets-bucket",
            requireBootstrap: false,
          },
        },
        functions: {
          hello: {
            handler: "src/hello.handler",
            build: {
              mode: "none",
            },
          },
        },
      }),
    );

    const { app } = buildApp(config);
    const assembly = app.synth();
    const stackArtifact = assembly.getStackArtifact(config.stackName);
    expect(stackArtifact).toBeTruthy();
  });

  test("infers bootstrap rule disabled when deployment overrides are provided", () => {
    const config = normalizeConfig(
      validateServiceConfig({
        service: "demo",
        provider: {
          account: "123456789012",
          region: "us-east-1",
          deployment: {
            fileAssetsBucketName: "custom-assets-bucket",
          },
        },
        functions: {
          hello: {
            handler: "src/hello.handler",
            build: {
              mode: "none",
            },
          },
        },
      }),
    );

    const { app } = buildApp(config);
    const assembly = app.synth();
    const stackArtifact = assembly.getStackArtifact(config.stackName);
    const rules =
      (stackArtifact.template as { Rules?: Record<string, unknown> }).Rules ?? {};
    expect(Object.keys(rules)).toHaveLength(0);
  });

  test("keeps bootstrap rule by default when no deployment overrides exist", () => {
    const config = normalizeConfig(
      validateServiceConfig({
        service: "demo",
        provider: {
          account: "123456789012",
          region: "us-east-1",
        },
        functions: {
          hello: {
            handler: "src/hello.handler",
            build: {
              mode: "none",
            },
          },
        },
      }),
    );

    const { app } = buildApp(config);
    const assembly = app.synth();
    const stackArtifact = assembly.getStackArtifact(config.stackName);
    const rules =
      (stackArtifact.template as { Rules?: Record<string, unknown> }).Rules ?? {};
    expect(Object.keys(rules).length).toBeGreaterThan(0);
  });

  test("infers cli credentials synthesizer when only asset overrides are provided", () => {
    const config = normalizeConfig(
      validateServiceConfig({
        service: "demo",
        provider: {
          account: "123456789012",
          region: "us-east-1",
          deployment: {
            fileAssetsBucketName: "custom-assets-bucket",
          },
        },
        functions: {
          hello: {
            handler: "src/hello.handler",
            build: {
              mode: "none",
            },
          },
        },
      }),
    );

    const { stack } = buildApp(config);
    expect(stack.synthesizer.constructor.name).toBe("CliCredentialsStackSynthesizer");
  });

  test("does not infer cli credentials synthesizer when role overrides are provided", () => {
    const config = normalizeConfig(
      validateServiceConfig({
        service: "demo",
        provider: {
          account: "123456789012",
          region: "us-east-1",
          deployment: {
            fileAssetsBucketName: "custom-assets-bucket",
            deployRoleArn: "arn:aws:iam::123456789012:role/MyDeployRole",
          },
        },
        functions: {
          hello: {
            handler: "src/hello.handler",
            build: {
              mode: "none",
            },
          },
        },
      }),
    );

    const { stack } = buildApp(config);
    expect(stack.synthesizer.constructor.name).toBe("DefaultStackSynthesizer");
  });

  test("rejects explicit cli credentials with role overrides", () => {
    const config = normalizeConfig(
      validateServiceConfig({
        service: "demo",
        provider: {
          account: "123456789012",
          region: "us-east-1",
          deployment: {
            useCliCredentials: true,
            deployRoleArn: "arn:aws:iam::123456789012:role/MyDeployRole",
          },
        },
        functions: {
          hello: {
            handler: "src/hello.handler",
            build: {
              mode: "none",
            },
          },
        },
      }),
    );

    expect(() => buildApp(config)).toThrow(
      "cannot be combined with deployRoleArn",
    );
  });

  test("allows explicit cli credentials with cloudformation execution role", () => {
    const config = normalizeConfig(
      validateServiceConfig({
        service: "demo",
        provider: {
          account: "123456789012",
          region: "us-east-1",
          deployment: {
            useCliCredentials: true,
            cloudFormationExecutionRoleArn:
              "arn:aws:iam::123456789012:role/MyExecRole",
          },
        },
        functions: {
          hello: {
            handler: "src/hello.handler",
            build: {
              mode: "none",
            },
          },
        },
      }),
    );

    const { stack } = buildApp(config);
    expect(stack.synthesizer.constructor.name).toBe(
      "CliCredentialsStackSynthesizer",
    );
  });

  test("infers cli credentials synthesizer with asset bucket and cloudformation execution role", () => {
    const config = normalizeConfig(
      validateServiceConfig({
        service: "demo",
        provider: {
          account: "123456789012",
          region: "us-east-1",
          deployment: {
            fileAssetsBucketName: "custom-assets-bucket",
            cloudFormationExecutionRoleArn:
              "arn:aws:iam::123456789012:role/MyExecRole",
          },
        },
        functions: {
          hello: {
            handler: "src/hello.handler",
            build: {
              mode: "none",
            },
          },
        },
      }),
    );

    const { stack } = buildApp(config);
    expect(stack.synthesizer.constructor.name).toBe(
      "CliCredentialsStackSynthesizer",
    );
  });

  test("rejects cloudFormationServiceRoleArn with deployment role overrides", () => {
    const config = normalizeConfig(
      validateServiceConfig({
        service: "demo",
        provider: {
          account: "123456789012",
          region: "us-east-1",
          deployment: {
            cloudFormationServiceRoleArn:
              "arn:aws:iam::123456789012:role/MyCloudFormationServiceRole",
            deployRoleArn: "arn:aws:iam::123456789012:role/MyDeployRole",
          },
        },
        functions: {
          hello: {
            handler: "src/hello.handler",
            build: {
              mode: "none",
            },
          },
        },
      }),
    );

    expect(() => buildApp(config)).toThrow(
      "cloudFormationServiceRoleArn cannot be combined with deployRoleArn/cloudFormationExecutionRoleArn",
    );
  });
});
