import type { DomainConfigKey } from "../compiler/plugins/domain-configs.js";
import type { DomainConfigs } from "../compiler/plugins/domain-configs.js";
import type { DomainPlugin } from "../compiler/plugins/domain-plugin.js";
import type { NormalizedServiceConfig } from "../config/normalize.js";
import type {
  CloudFormationDomainConfigInput,
  ServerlessDomainState,
} from "./adapters/types.js";

export type DomainLifecycleRole = "resource" | "functions" | "binding";

/**
 * Explicit event-binding handoff contract between domains.
 *
 * Functions are the current producer of binding events; binding domains
 * consume those events to wire triggers/integrations.
 */
export interface DomainEventBindingContract {
  readonly produces: boolean;
  readonly consumes: boolean;
}

interface DomainDescriptorBase {
  readonly id: string;
  readonly order: number;
  readonly role: DomainLifecycleRole;
  readonly plugin: DomainPlugin;
  readonly eventBindings?: DomainEventBindingContract;
}

export interface DomainDefinitionAdapters<T> {
  readonly yamlcdk?: (config: NormalizedServiceConfig) => T;
  readonly cloudformation?: (input: CloudFormationDomainConfigInput) => T;
  readonly serverlessRead?: (
    domainConfigs: DomainConfigs,
    state: ServerlessDomainState,
  ) => void;
  readonly serverlessWrite?: (
    domainConfigs: DomainConfigs,
    state: ServerlessDomainState,
  ) => void;
}

export interface DomainDescriptorWithConfig<T> extends DomainDescriptorBase {
  readonly configKey: DomainConfigKey<T>;
  readonly adapters?: DomainDefinitionAdapters<T>;
}

export interface DomainDescriptorWithoutConfig extends DomainDescriptorBase {
  readonly configKey?: undefined;
  readonly adapters?: undefined;
}

export type DomainDescriptor<T = unknown> =
  | DomainDescriptorWithConfig<T>
  | DomainDescriptorWithoutConfig;

export function hasDomainConfigKey<T>(
  descriptor: DomainDescriptor<T>,
): descriptor is DomainDescriptorWithConfig<T> {
  return descriptor.configKey !== undefined;
}
