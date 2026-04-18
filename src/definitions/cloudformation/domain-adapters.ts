import { DomainConfigs } from "../../compiler/plugins/domain-configs.js";
import type { CloudFormationDomainConfigInput } from "../domain-adapter-types.js";
import { S3_CONFIG } from "../../domains/s3/model.js";
import { DYNAMODB_CONFIG } from "../../domains/dynamodb/model.js";
import { SQS_CONFIG } from "../../domains/sqs/model.js";
import { SNS_CONFIG } from "../../domains/sns/model.js";
import { APIS_CONFIG } from "../../domains/apis/model.js";
import { CLOUDFRONT_CONFIG } from "../../domains/cloudfront/model.js";

export function adaptDomainConfigsFromCloudFormation(
  input: CloudFormationDomainConfigInput,
): DomainConfigs {
  const domainConfigs = new DomainConfigs();
  domainConfigs.set(S3_CONFIG, input.s3);
  domainConfigs.set(DYNAMODB_CONFIG, input.dynamodb);
  domainConfigs.set(SQS_CONFIG, input.sqs);
  domainConfigs.set(SNS_CONFIG, input.sns);
  domainConfigs.set(APIS_CONFIG, input.apis);
  domainConfigs.set(CLOUDFRONT_CONFIG, input.cloudfront);
  return domainConfigs;
}
