export {
  DomainConfigs,
  createDomainConfigKey,
  type DomainConfigKey,
} from "./domain-configs.js";

export {
  type DomainPlugin,
  type CompilationContext,
  type EventBinding,
  type ResourceRefs,
  type SynthesisResult,
} from "./domain-plugin.js";

export {
  type DefinitionPlugin,
  type DefinitionPluginLoadOptions,
} from "./definition-plugin.js";

export {
  PluginRegistry,
  DomainRegistry,
  DefinitionRegistry,
} from "./registry.js";
