/**
 * Shared definition registry setup.
 *
 * Registers all bundled definition plugins in priority order.
 * More specific plugins (cloudformation) are registered first so
 * they take precedence over the catch-all yamlcdk plugin.
 */

import { DefinitionRegistry } from "../compiler/plugins/registry.js";
import { cloudformationDefinitionPlugin } from "./cloudformation/index.js";
import { yamlcdkDefinitionPlugin } from "./yamlcdk/index.js";

export function createDefinitionRegistry(): DefinitionRegistry {
  const registry = new DefinitionRegistry();
  // CloudFormation plugin: matches templates with AWSTemplateFormatVersion / AWS:: resource types
  registry.register(cloudformationDefinitionPlugin);
  // yamlcdk plugin: catch-all for .yml/.yaml files
  registry.register(yamlcdkDefinitionPlugin);
  return registry;
}

export const definitionRegistry = createDefinitionRegistry();
