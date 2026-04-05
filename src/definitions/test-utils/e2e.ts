import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { Template } from "aws-cdk-lib/assertions";
import { buildApp } from "../../compiler/stack-builder.js";
import { definitionRegistry } from "../registry.js";

export interface ResourceDefinition extends Record<string, unknown> {
  DeletionPolicy?: string;
  Properties?: Record<string, unknown>;
}

export function writeTmpYaml(
  content: string,
  filename = "definition.yml",
): string {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "yamlcdk-definition-test-"));
  const filePath = path.join(dir, filename);

  fs.writeFileSync(filePath, content.trimStart(), "utf8");

  return filePath;
}

export function resolveDefinitionFromYaml(
  content: string,
  filename = "definition.yml",
) {
  const filePath = writeTmpYaml(content, filename);
  const plugin = definitionRegistry.resolve(filePath);

  return { filePath, plugin };
}

export function loadDefinitionFromYaml(
  content: string,
  filename = "definition.yml",
) {
  const { filePath, plugin } = resolveDefinitionFromYaml(content, filename);
  const model = plugin.load(filePath);

  return { filePath, plugin, model };
}

export function buildDefinitionFromYaml(
  content: string,
  filename = "definition.yml",
) {
  const { filePath, plugin, model } = loadDefinitionFromYaml(content, filename);
  const { stack } = buildApp(model);
  const template = Template.fromStack(stack);

  return { filePath, plugin, model, stack, template };
}

export function firstResourceOfType<T extends ResourceDefinition>(
  template: Template,
  type: string,
): T | undefined {
  return Object.values(template.findResources(type) as Record<string, T>)[0];
}
