import type { DomainConfigs } from "../../compiler/plugins/domain-configs.js";
import type { NormalizedServiceConfig } from "../../config/normalize.js";
import type {
  CloudFormationDomainConfigInput,
  ServerlessDomainState,
} from "../adapters/types.js";
import {
  DYNAMODB_CONFIG,
  type DynamoDBDomainConfig,
} from "./model.js";

export function adaptDynamodbDomainFromYamlcdk(
  config: NormalizedServiceConfig,
): DynamoDBDomainConfig {
  return { tables: config.storage.dynamodb };
}

export function adaptDynamodbDomainFromCloudFormation(
  input: CloudFormationDomainConfigInput,
): DynamoDBDomainConfig {
  return input.dynamodb;
}

export function readDynamodbServerlessDomainState(
  domainConfigs: DomainConfigs,
  state: ServerlessDomainState,
): void {
  state.dynamodb = domainConfigs.get(DYNAMODB_CONFIG)?.tables ?? {};
}

export function writeDynamodbServerlessDomainConfig(
  domainConfigs: DomainConfigs,
  state: ServerlessDomainState,
): void {
  domainConfigs.set(DYNAMODB_CONFIG, { tables: state.dynamodb });
}

