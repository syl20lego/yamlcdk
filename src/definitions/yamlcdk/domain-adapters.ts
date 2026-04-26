import { DomainConfigs } from "../../compiler/plugins/domain-configs.js";
import type { NormalizedServiceConfig } from "../../config/normalize.js";
import {
  S3_CONFIG,
  s3YamlcdkStorageSchema,
  type S3DomainConfig,
} from "../../domains/s3/model.js";
import {
  DYNAMODB_CONFIG,
  dynamodbYamlcdkStorageSchema,
  type DynamoDBDomainConfig,
} from "../../domains/dynamodb/model.js";
import {
  SQS_CONFIG,
  sqsYamlcdkMessagingSchema,
  type SQSDomainConfig,
} from "../../domains/sqs/model.js";
import {
  SNS_CONFIG,
  snsYamlcdkMessagingSchema,
  type SNSDomainConfig,
} from "../../domains/sns/model.js";
import {
  EVENTBRIDGE_CONFIG,
  eventbridgeYamlcdkMessagingSchema,
  type EventBridgeDomainConfig,
} from "../../domains/eventbridge/model.js";
import { APIS_CONFIG, type ApisDomainConfig } from "../../domains/apis/model.js";
import {
  CLOUDFRONT_CONFIG,
  cloudfrontYamlcdkCachePoliciesSchema,
  cloudfrontYamlcdkDistributionsSchema,
  cloudfrontYamlcdkOriginRequestPoliciesSchema,
  type CloudFrontDomainConfig,
} from "../../domains/cloudfront/model.js";

function adaptS3(config: NormalizedServiceConfig): S3DomainConfig {
  return {
    buckets: s3YamlcdkStorageSchema.parse(config.storage.s3),
    cleanupRoleArn: config.provider.s3?.cleanupRoleArn,
  };
}

function adaptDynamodb(config: NormalizedServiceConfig): DynamoDBDomainConfig {
  return { tables: dynamodbYamlcdkStorageSchema.parse(config.storage.dynamodb) };
}

function adaptSqs(config: NormalizedServiceConfig): SQSDomainConfig {
  return { queues: sqsYamlcdkMessagingSchema.parse(config.messaging.sqs) };
}

function adaptSns(config: NormalizedServiceConfig): SNSDomainConfig {
  return { topics: snsYamlcdkMessagingSchema.parse(config.messaging.sns) };
}

function adaptEventBridge(config: NormalizedServiceConfig): EventBridgeDomainConfig {
  return {
    eventBuses: eventbridgeYamlcdkMessagingSchema.parse(config.messaging.eventbridge),
  };
}

function adaptApis(config: NormalizedServiceConfig): ApisDomainConfig {
  return {
    restApi: config.provider.restApi
      ? { cloudWatchRoleArn: config.provider.restApi.cloudWatchRoleArn }
      : undefined,
  };
}

function adaptCloudfront(config: NormalizedServiceConfig): CloudFrontDomainConfig {
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

export function adaptDomainConfigsFromYamlcdk(
  config: NormalizedServiceConfig,
): DomainConfigs {
  const domainConfigs = new DomainConfigs();
  domainConfigs.set(S3_CONFIG, adaptS3(config));
  domainConfigs.set(DYNAMODB_CONFIG, adaptDynamodb(config));
  domainConfigs.set(SQS_CONFIG, adaptSqs(config));
  domainConfigs.set(SNS_CONFIG, adaptSns(config));
  domainConfigs.set(EVENTBRIDGE_CONFIG, adaptEventBridge(config));
  domainConfigs.set(APIS_CONFIG, adaptApis(config));
  domainConfigs.set(CLOUDFRONT_CONFIG, adaptCloudfront(config));
  return domainConfigs;
}
