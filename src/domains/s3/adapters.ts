import type { DomainConfigs } from "../../compiler/plugins/domain-configs.js";
import type { NormalizedServiceConfig } from "../../config/normalize.js";
import type {
  CloudFormationDomainConfigInput,
  ServerlessDomainState,
} from "../adapters/types.js";
import { S3_CONFIG, type S3DomainConfig } from "./model.js";

export function adaptS3DomainFromYamlcdk(
  config: NormalizedServiceConfig,
): S3DomainConfig {
  return {
    buckets: config.storage.s3,
    cleanupRoleArn: config.provider.s3?.cleanupRoleArn,
  };
}

export function adaptS3DomainFromCloudFormation(
  input: CloudFormationDomainConfigInput,
): S3DomainConfig {
  return input.s3;
}

export function readS3ServerlessDomainState(
  domainConfigs: DomainConfigs,
  state: ServerlessDomainState,
): void {
  state.s3 = domainConfigs.get(S3_CONFIG)?.buckets ?? {};
}

export function writeS3ServerlessDomainConfig(
  domainConfigs: DomainConfigs,
  state: ServerlessDomainState,
): void {
  domainConfigs.set(S3_CONFIG, { buckets: state.s3 });
}

