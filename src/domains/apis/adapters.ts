import type { DomainConfigs } from "../../compiler/plugins/domain-configs.js";
import type { NormalizedServiceConfig } from "../../config/normalize.js";
import type {
  CloudFormationDomainConfigInput,
  ServerlessDomainState,
} from "../adapters/types.js";
import { APIS_CONFIG, type ApisDomainConfig } from "./model.js";

export function adaptApisDomainFromYamlcdk(
  config: NormalizedServiceConfig,
): ApisDomainConfig {
  return {
    restApi: config.provider.restApi
      ? { cloudWatchRoleArn: config.provider.restApi.cloudWatchRoleArn }
      : undefined,
  };
}

export function adaptApisDomainFromCloudFormation(
  input: CloudFormationDomainConfigInput,
): ApisDomainConfig {
  return input.apis;
}

export function writeApisServerlessDomainConfig(
  domainConfigs: DomainConfigs,
  _state: ServerlessDomainState,
): void {
  domainConfigs.set(APIS_CONFIG, { restApi: undefined });
}

