import type { DomainConfigs } from "../../compiler/plugins/domain-configs.js";
import type { NormalizedServiceConfig } from "../../config/normalize.js";
import type {
  CloudFormationDomainConfigInput,
  ServerlessDomainState,
} from "../adapters/types.js";
import {
  CLOUDFRONT_CONFIG,
  cloudfrontYamlcdkCachePoliciesSchema,
  cloudfrontYamlcdkDistributionsSchema,
  cloudfrontYamlcdkOriginRequestPoliciesSchema,
  type CloudFrontDomainConfig,
} from "./model.js";

export function adaptCloudfrontDomainFromYamlcdk(
  config: NormalizedServiceConfig,
): CloudFrontDomainConfig {
  return {
    cachePolicies: cloudfrontYamlcdkCachePoliciesSchema.parse(
      config.cdn.cachePolicies,
    ),
    originRequestPolicies: cloudfrontYamlcdkOriginRequestPoliciesSchema.parse(
      config.cdn.originRequestPolicies,
    ),
    distributions: cloudfrontYamlcdkDistributionsSchema.parse(
      config.cdn.distributions,
    ),
  };
}

export function adaptCloudfrontDomainFromCloudFormation(
  input: CloudFormationDomainConfigInput,
): CloudFrontDomainConfig {
  return input.cloudfront;
}

export function readCloudfrontServerlessDomainState(
  domainConfigs: DomainConfigs,
  state: ServerlessDomainState,
): void {
  const cloudfrontConfig = domainConfigs.get(CLOUDFRONT_CONFIG);
  state.cloudfront = {
    cachePolicies: cloudfrontConfig?.cachePolicies ?? {},
    originRequestPolicies: cloudfrontConfig?.originRequestPolicies ?? {},
    distributions: cloudfrontConfig?.distributions ?? {},
  };
}

export function writeCloudfrontServerlessDomainConfig(
  domainConfigs: DomainConfigs,
  state: ServerlessDomainState,
): void {
  domainConfigs.set(CLOUDFRONT_CONFIG, {
    cachePolicies: state.cloudfront.cachePolicies,
    originRequestPolicies: state.cloudfront.originRequestPolicies,
    distributions: state.cloudfront.distributions,
  });
}
