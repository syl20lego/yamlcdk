export {
  DomainConfigs,
  createDomainConfigKey,
  type DomainConfigKey,
} from "./domain-configs.js";

export * from "./native-domain-configs.js";

export {
  type DomainPlugin,
  type CompilationContext,
  type EventBinding,
  type ResourceRefs,
  type SynthesisResult,
  type DomainValidationContribution,
  type ValidationReportSection,
  type ValidationReportStatus,
} from "./domain-plugin.js";

export { type BuildResult } from "../../runtime/build.js";

export {
  type DefinitionPlugin,
  type DefinitionPluginLoadOptions,
} from "./definition-plugin.js";

export {
  PluginRegistry,
  DomainRegistry,
  DefinitionRegistry,
} from "./registry.js";
