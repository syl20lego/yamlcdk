import type { DomainConfigs } from "../../compiler/plugins/domain-configs.js";
import type { NormalizedServiceConfig } from "../../config/normalize.js";
import type {
  CloudFormationDomainConfigInput,
  ServerlessDomainState,
} from "../adapters/types.js";
import {
  SQS_CONFIG,
  sqsYamlcdkMessagingSchema,
  type SQSDomainConfig,
} from "./model.js";

export function adaptSqsDomainFromYamlcdk(
  config: NormalizedServiceConfig,
): SQSDomainConfig {
  return { queues: sqsYamlcdkMessagingSchema.parse(config.messaging.sqs) };
}

export function adaptSqsDomainFromCloudFormation(
  input: CloudFormationDomainConfigInput,
): SQSDomainConfig {
  return input.sqs;
}

export function readSqsServerlessDomainState(
  domainConfigs: DomainConfigs,
  state: ServerlessDomainState,
): void {
  state.sqs = domainConfigs.get(SQS_CONFIG)?.queues ?? {};
}

export function writeSqsServerlessDomainConfig(
  domainConfigs: DomainConfigs,
  state: ServerlessDomainState,
): void {
  domainConfigs.set(SQS_CONFIG, { queues: state.sqs });
}
