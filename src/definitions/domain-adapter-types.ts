import type {
  ApisDomainConfig,
} from "../domains/apis/model.js";
import type {
  CloudFrontDomainConfig,
} from "../domains/cloudfront/model.js";
import type {
  DynamoDBDomainConfig,
} from "../domains/dynamodb/model.js";
import type {
  S3DomainConfig,
} from "../domains/s3/model.js";
import type {
  SNSDomainConfig,
} from "../domains/sns/model.js";
import type {
  SQSDomainConfig,
} from "../domains/sqs/model.js";

export interface CloudFormationDomainConfigInput {
  readonly [domainId: string]: unknown;
  readonly s3: S3DomainConfig;
  readonly dynamodb: DynamoDBDomainConfig;
  readonly sqs: SQSDomainConfig;
  readonly sns: SNSDomainConfig;
  readonly apis: ApisDomainConfig;
  readonly cloudfront: CloudFrontDomainConfig;
}

export interface ServerlessDomainState {
  [domainId: string]: unknown;
  s3: S3DomainConfig["buckets"];
  dynamodb: DynamoDBDomainConfig["tables"];
  sqs: SQSDomainConfig["queues"];
  sns: SNSDomainConfig["topics"];
  cloudfront: CloudFrontDomainConfig;
}

export function createEmptyServerlessDomainState(): ServerlessDomainState {
  return {
    s3: {},
    dynamodb: {},
    sqs: {},
    sns: {},
    cloudfront: { cachePolicies: {}, originRequestPolicies: {}, distributions: {} },
  };
}
