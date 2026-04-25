import { describe, expect, test } from "vitest";
import { definitionRegistry } from "../../registry.js";
import { writeTmpYaml } from "../../test-utils/e2e.js";
import { serverlessDefinitionPlugin } from "../plugin.js";

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

  test("canLoad accepts canonical serverless.yaml filename", () => {
    const serverlessPath = writeTmpYaml(
      "service: demo\nprovider:\n  name: aws\nfunctions: {}\n",
      "serverless.yaml",
    );

    expect(serverlessDefinitionPlugin.canLoad(serverlessPath)).toBe(true);
  });

  test("canLoad detects non-standard filenames by aws provider markers", () => {
    const serverlessPath = writeTmpYaml(
      "service: demo\nprovider:\n  name: aws\nfunctions: {}\n",
      "infra.yml",
    );

    expect(serverlessDefinitionPlugin.canLoad(serverlessPath)).toBe(true);
  });

  test("generateStarter returns valid Serverless YAML content", () => {
    const content = serverlessDefinitionPlugin.generateStarter!();
    expect(content).toContain("service:");
    expect(content).toContain("provider:");
    expect(content).toContain("name: aws");
    expect(content).toContain("resources:");
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
