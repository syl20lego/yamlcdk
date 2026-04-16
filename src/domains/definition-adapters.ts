import { DomainConfigs } from "../compiler/plugins/domain-configs.js";
import type { NormalizedServiceConfig } from "../config/normalize.js";
import { hasDomainConfigKey } from "./contracts.js";
import {
  type CloudFormationDomainConfigInput,
  createEmptyServerlessDomainState,
  type ServerlessDomainState,
} from "./adapters/types.js";
import { orderedDomainManifest } from "./manifest.js";

export function adaptDomainConfigsFromYamlcdk(
  config: NormalizedServiceConfig,
): DomainConfigs {
  const domainConfigs = new DomainConfigs();

  for (const descriptor of orderedDomainManifest) {
    if (!hasDomainConfigKey(descriptor)) continue;
    const adapted = descriptor.adapters?.yamlcdk?.(config);
    if (adapted !== undefined) {
      domainConfigs.set(descriptor.configKey, adapted);
    }
  }

  return domainConfigs;
}

export function adaptDomainConfigsFromCloudFormation(
  input: CloudFormationDomainConfigInput,
): DomainConfigs {
  const domainConfigs = new DomainConfigs();

  for (const descriptor of orderedDomainManifest) {
    if (!hasDomainConfigKey(descriptor)) continue;
    const adapted = descriptor.adapters?.cloudformation?.(input);
    if (adapted !== undefined) {
      domainConfigs.set(descriptor.configKey, adapted);
    }
  }

  return domainConfigs;
}

export function readServerlessDomainStateFromConfigs(
  domainConfigs: DomainConfigs,
): ServerlessDomainState {
  const state = createEmptyServerlessDomainState();

  for (const descriptor of orderedDomainManifest) {
    if (!hasDomainConfigKey(descriptor)) continue;
    descriptor.adapters?.serverlessRead?.(domainConfigs, state);
  }

  return state;
}

export function writeServerlessDomainStateToConfigs(
  domainConfigs: DomainConfigs,
  state: ServerlessDomainState,
): void {
  for (const descriptor of orderedDomainManifest) {
    if (!hasDomainConfigKey(descriptor)) continue;
    descriptor.adapters?.serverlessWrite?.(domainConfigs, state);
  }
}

