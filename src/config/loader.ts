/**
 * Load a config file into a {@link ServiceModel} via the definition plugin system.
 *
 * Resolves the appropriate definition plugin (yamlcdk, cloudformation, …)
 * through the shared {@link definitionRegistry}.
 */

import type { ServiceModel } from "../compiler/model.js";
import { parseServiceModel } from "../compiler/model.js";
import type { DefinitionPluginLoadOptions } from "../compiler/plugins/index.js";
import { definitionRegistry } from "../definitions/registry.js";

export function loadModel(
  filePath: string,
  options: DefinitionPluginLoadOptions = {},
): ServiceModel {
  const plugin = definitionRegistry.resolve(filePath);
  return parseServiceModel(plugin.load(filePath, options));
}
