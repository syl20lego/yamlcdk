import type { DomainConfigs } from "../../compiler/plugins/domain-configs.js";
import type { NormalizedServiceConfig } from "../../config/normalize.js";
import type {
  CloudFormationDomainConfigInput,
  ServerlessDomainState,
} from "../adapters/types.js";
import {
  SNS_CONFIG,
  snsYamlcdkMessagingSchema,
  type SNSDomainConfig,
} from "./model.js";

export function adaptSnsDomainFromYamlcdk(
  config: NormalizedServiceConfig,
): SNSDomainConfig {
  return { topics: snsYamlcdkMessagingSchema.parse(config.messaging.sns) };
}

export function adaptSnsDomainFromCloudFormation(
  input: CloudFormationDomainConfigInput,
): SNSDomainConfig {
  return input.sns;
}

export function readSnsServerlessDomainState(
  domainConfigs: DomainConfigs,
  state: ServerlessDomainState,
): void {
  state.sns = domainConfigs.get(SNS_CONFIG)?.topics ?? {};
}

export function writeSnsServerlessDomainConfig(
  domainConfigs: DomainConfigs,
  state: ServerlessDomainState,
): void {
  domainConfigs.set(SNS_CONFIG, { topics: state.sns });
}
