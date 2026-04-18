import type { DomainConfigKey } from "../compiler/plugins/domain-configs.js";
import type { DomainPlugin } from "../compiler/plugins/domain-plugin.js";
import type { ZodTypeAny } from "zod";

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

export type DomainYamlcdkSectionNamespace = "storage" | "messaging" | "cdn";

export interface DomainYamlcdkSectionRegistration<
  TSchema extends ZodTypeAny = ZodTypeAny,
> {
  readonly namespace: DomainYamlcdkSectionNamespace;
  readonly key: string;
  readonly schema: TSchema;
  readonly createDefault: () => unknown;
}

interface DomainDescriptorBase {
  readonly id: string;
  readonly order: number;
  readonly role: DomainLifecycleRole;
  readonly plugin: DomainPlugin;
  readonly eventBindings?: DomainEventBindingContract;
  readonly yamlcdkSections?: readonly DomainYamlcdkSectionRegistration[];
}

export interface DomainDescriptorWithConfig<T> extends DomainDescriptorBase {
  readonly configKey: DomainConfigKey<T>;
}

export interface DomainDescriptorWithoutConfig extends DomainDescriptorBase {
  readonly configKey?: undefined;
}

export type DomainDescriptor<T = unknown> =
  | DomainDescriptorWithConfig<T>
  | DomainDescriptorWithoutConfig;

export function hasDomainConfigKey<T>(
  descriptor: DomainDescriptor<T>,
): descriptor is DomainDescriptorWithConfig<T> {
  return descriptor.configKey !== undefined;
}
