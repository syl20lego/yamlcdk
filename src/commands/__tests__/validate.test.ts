import { describe, expect, test, vi } from "vitest";
import { writeTmpYaml } from "../../definitions/test-utils/e2e.js";
import { runValidate } from "../validate.js";

describe("runValidate", () => {
  test("applies AWS overrides and prints the validate overview report", () => {
    const configPath = writeTmpYaml(`
service: demo
provider:
  stage: dev
  region: us-east-1
  deployment:
    requireBootstrap: false
functions:
  hello:
    handler: src/hello.handler
    build:
      mode: none
`);

    const writeSpy = vi
      .spyOn(process.stdout, "write")
      .mockImplementation(() => true);

    let output = "";
    try {
      runValidate({
        config: configPath,
        region: "us-west-2",
      });
      output = writeSpy.mock.calls.map(([chunk]) => String(chunk)).join("");
    } finally {
      writeSpy.mockRestore();
    }
    expect(output).toContain("Validation report (overview):");
    expect(output).toContain("us-west-2");
    expect(output).toContain("Resources");
    expect(output).toContain("AWS::Lambda::Function");
  });

  test("does not require handler build artifacts in validate mode", () => {
    const configPath = writeTmpYaml(`
service: demo
provider:
  stage: dev
  region: us-east-1
functions:
  hello:
    handler: src/handlers/missing.handler
    build:
      mode: typescript
`);

    const writeSpy = vi
      .spyOn(process.stdout, "write")
      .mockImplementation(() => true);

    let output = "";
    try {
      runValidate({
        config: configPath,
      });
      output = writeSpy.mock.calls.map(([chunk]) => String(chunk)).join("");
    } finally {
      writeSpy.mockRestore();
    }

    expect(output).toContain("Validation report (overview):");
    expect(output).toContain("AWS::Lambda::Function");
  });

  test("supports json output format", () => {
    const configPath = writeTmpYaml(`
service: demo
provider:
  stage: dev
  region: us-east-1
functions:
  hello:
    handler: src/hello.handler
    build:
      mode: none
`);

    const writeSpy = vi
      .spyOn(process.stdout, "write")
      .mockImplementation(() => true);

    let output = "";
    try {
      runValidate({
        config: configPath,
        output: "json",
      });
      output = writeSpy.mock.calls.map(([chunk]) => String(chunk)).join("");
    } finally {
      writeSpy.mockRestore();
    }

    const parsed = JSON.parse(output) as {
      overviewRows: unknown[];
      resourceDetailTables: unknown[];
      nonResourceSectionTables: unknown[];
    };
    expect(parsed.overviewRows.length).toBeGreaterThan(0);
    expect(parsed.resourceDetailTables.length).toBeGreaterThan(0);
  });
});
