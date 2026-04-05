import { Template } from "aws-cdk-lib/assertions";
import { buildApp } from "../../stack-builder.js";
import { normalizeConfig } from "../../../config/normalize.js";
import {
  type RawServiceConfig,
  validateServiceConfig,
} from "../../../config/schema.js";

type RawFunctionConfig = NonNullable<RawServiceConfig["functions"]>[string];

export interface ResourceDefinition extends Record<string, unknown> {
  DeletionPolicy?: string;
  Properties?: Record<string, unknown>;
}

export function functionConfig(
  overrides: Partial<RawFunctionConfig> = {},
): RawFunctionConfig {
  return {
    handler: "src/hello.handler",
    ...overrides,
    build: {
      mode: "none",
      ...overrides.build,
    },
  };
}

export function synthServiceConfig(input: Omit<RawServiceConfig, "service"> & {
  service?: string;
}) {
  const raw = validateServiceConfig({
    service: "demo",
    ...input,
  });
  const config = normalizeConfig(raw);
  const { stack } = buildApp(config);
  const template = Template.fromStack(stack);

  return { config, stack, template };
}

export function firstResourceOfType<T extends ResourceDefinition>(
  template: Template,
  type: string,
): T | undefined {
  return Object.values(template.findResources(type) as Record<string, T>)[0];
}
