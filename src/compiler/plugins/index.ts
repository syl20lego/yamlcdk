export {
  DomainConfigs,
  createDomainConfigKey,
  type DomainConfigKey,
} from "./domain-configs.js";

export * from "../../domains/s3/index.js";
export * from "../../domains/dynamodb/index.js";
export * from "../../domains/sqs/index.js";
export * from "../../domains/sns/index.js";
export * from "../../domains/apis/index.js";
export * from "../../domains/cloudfront/index.js";
export * from "../../domains/functions/index.js";
export * from "../../domains/eventbridge/index.js";

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
