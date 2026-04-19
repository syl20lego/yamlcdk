import { describe, expect, test } from "vitest";
import { buildApp } from "../../compiler/stack-builder.js";
import { validateServiceConfig } from "../../config/schema.js";
import { normalizeConfig } from "../../config/normalize.js";
import {
  buildValidationReport,
  buildValidationReportRows,
  buildValidationReportRowsFromTemplate,
  renderValidationReportJson,
  renderValidationReportText,
} from "../validate-report.js";

function buildModelWithFunctionReport() {
  const config = normalizeConfig(
    validateServiceConfig({
      service: "demo",
      provider: {
        region: "us-east-1",
        stage: "dev",
        deployment: {
          requireBootstrap: false,
        },
      },
      functions: {
        hello: {
          handler: "src/hello.handler",
          build: {
            mode: "none",
          },
          timeout: 15,
          memorySize: 512,
          url: {
            authType: "NONE",
            invokeMode: "BUFFERED",
            cors: {
              allowedMethods: ["GET"],
              allowOrigins: ["https://example.com"],
            },
          },
          events: {
            http: [{ method: "GET", path: "/hello" }],
            eventbridge: [{ schedule: "rate(1 hour)" }],
          },
        },
      },
    }),
  );

  const { stack } = buildApp(config);
  return stack;
}

describe("validation report", () => {
  test("collects rows for all supported template sections", () => {
    const stack = buildModelWithFunctionReport();
    const rows = buildValidationReportRowsFromTemplate(stack.model, {
      Resources: {
        FunctionhelloABCD1234: {
          Type: "AWS::Lambda::Function",
          Properties: {
            FunctionName: "hello-dev",
          },
        },
      },
      Parameters: {
        BootstrapVersion: {
          Type: "AWS::SSM::Parameter::Value<String>",
        },
      },
      Outputs: {
        HttpApiUrl: {
          Value: "https://example.com",
        },
      },
      Rules: {
        CheckBootstrapVersion: {
          Assertions: [],
        },
      },
      Conditions: {
        IsProd: {
          "Fn::Equals": ["dev", "prod"],
        },
      },
    });

    expect(rows.map((row) => row.section)).toEqual([
      "Resources",
      "Parameters",
      "Outputs",
      "Rules",
      "Conditions",
    ]);

    const lambdaRow = rows[0];
    expect(lambdaRow.name).toBe("hello-dev");
    expect(lambdaRow.fqn).toContain("FunctionhelloABCD1234");
    expect(lambdaRow.fqn).toContain("hello-dev");
    expect(lambdaRow.status).toBe("valid");
  });

  test("adds function domain semantic properties to lambda rows", () => {
    const stack = buildModelWithFunctionReport();
    const rows = buildValidationReportRows(stack.model, stack);
    const lambdaRow = rows.find(
      (row) =>
        row.section === "Resources" &&
        row.type === "AWS::Lambda::Function" &&
        row.name === "hello-dev",
    );

    expect(lambdaRow).toBeDefined();
    expect(lambdaRow?.properties).toMatchObject({
      memory: 512,
      timeout: 15,
      role: expect.any(String),
    });
    expect(lambdaRow?.description).toContain('Lambda function "hello"');

    const linkedEvents = (lambdaRow?.properties?.linkedEvents ??
      []) as Array<Record<string, unknown>>;
    expect(linkedEvents).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          type: "http",
          method: "GET",
          path: "/hello",
        }),
        expect.objectContaining({
          type: "eventbridge",
          schedule: "rate(1 hour)",
        }),
      ]),
    );
  });

  test("renders overview + compact sections + detail tables in text output", () => {
    const stack = buildModelWithFunctionReport();
    const report = buildValidationReport(stack.model, stack);
    const output = renderValidationReportText(report);

    expect(output).toContain("Validation report (overview):");
    expect(output).toContain("Stage");
    expect(output).toContain("Outputs summary:");
    expect(output).toContain("AWS::Lambda::Function details:");
    expect(output).toContain("Memory");
    expect(output).toContain("Role");
    expect(output).toContain("Linked Events");
    expect(output).toContain("Status");
    expect(output).toContain("valid");
  });

  test("surfaces explicit function role arns in validation properties", () => {
    const config = normalizeConfig(
      validateServiceConfig({
        service: "demo",
        provider: {
          region: "us-east-1",
          stage: "dev",
          account: "123456789012",
        },
        functions: {
          hello: {
            handler: "src/hello.handler",
            build: {
              mode: "none",
            },
            iam: ["arn:aws:iam::123456789012:role/ExistingLambdaRole"],
          },
        },
      }),
    );
    const { stack } = buildApp(config);
    const rows = buildValidationReportRows(stack.model, stack);
    const lambdaRow = rows.find(
      (row) =>
        row.section === "Resources" &&
        row.type === "AWS::Lambda::Function" &&
        row.name === "hello-dev",
    );

    expect(lambdaRow?.properties?.role).toBe(
      "arn:aws:iam::123456789012:role/ExistingLambdaRole",
    );
  });

  test("renders machine-readable json output", () => {
    const stack = buildModelWithFunctionReport();
    const report = buildValidationReport(stack.model, stack);
    const output = renderValidationReportJson(report);
    const parsed = JSON.parse(output) as {
      overviewRows: unknown[];
      resourceDetailTables: unknown[];
      nonResourceSectionTables: unknown[];
    };

    expect(parsed.overviewRows.length).toBeGreaterThan(0);
    expect(parsed.resourceDetailTables.length).toBeGreaterThan(0);
    expect(parsed.nonResourceSectionTables.length).toBeGreaterThan(0);
  });
});
