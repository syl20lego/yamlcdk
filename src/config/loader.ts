/**
 * Load a config file into a {@link ServiceModel} via the definition plugin system.
 *
 * Currently routes all YAML files through the yamlcdk definition plugin.
 * When additional definition plugins are added (e.g. serverless.yml,
 * cloudformation.yml), this will resolve through a plugin registry.
 */

import type { ServiceModel } from "../compiler/model.js";
import { parseServiceModel } from "../compiler/model.js";
import { yamlcdkDefinitionPlugin } from "../definitions/yamlcdk/index.js";

export function loadModel(filePath: string): ServiceModel {
  return parseServiceModel(yamlcdkDefinitionPlugin.load(filePath));
}
