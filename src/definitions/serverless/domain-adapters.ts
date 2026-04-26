import type { DomainConfigs } from "../../compiler/plugins/domain-configs.js";
import {
  type ServerlessDomainState,
  createEmptyServerlessDomainState,
} from "../domain-adapter-types.js";
import { S3_CONFIG } from "../../domains/s3/model.js";
import { DYNAMODB_CONFIG } from "../../domains/dynamodb/model.js";
import { SQS_CONFIG } from "../../domains/sqs/model.js";
import { SNS_CONFIG } from "../../domains/sns/model.js";
import { EVENTBRIDGE_CONFIG } from "../../domains/eventbridge/model.js";
import { APIS_CONFIG } from "../../domains/apis/model.js";
import { CLOUDFRONT_CONFIG } from "../../domains/cloudfront/model.js";

// ─── Read: DomainConfigs → ServerlessDomainState ────────────

export function readServerlessDomainStateFromConfigs(
  domainConfigs: DomainConfigs,
): ServerlessDomainState {
  const state = createEmptyServerlessDomainState();
  state.s3 = domainConfigs.get(S3_CONFIG)?.buckets ?? {};
  state.dynamodb = domainConfigs.get(DYNAMODB_CONFIG)?.tables ?? {};
  state.sqs = domainConfigs.get(SQS_CONFIG)?.queues ?? {};
  state.sns = domainConfigs.get(SNS_CONFIG)?.topics ?? {};
  state.eventbridge = domainConfigs.get(EVENTBRIDGE_CONFIG)?.eventBuses ?? {};
  const cf = domainConfigs.get(CLOUDFRONT_CONFIG);
  state.cloudfront = {
    cachePolicies: cf?.cachePolicies ?? {},
    originRequestPolicies: cf?.originRequestPolicies ?? {},
    distributions: cf?.distributions ?? {},
  };
  return state;
}

// ─── Write: ServerlessDomainState → DomainConfigs ───────────

export function writeServerlessDomainStateToConfigs(
  domainConfigs: DomainConfigs,
  state: ServerlessDomainState,
): void {
  domainConfigs.set(S3_CONFIG, { buckets: state.s3 });
  domainConfigs.set(DYNAMODB_CONFIG, { tables: state.dynamodb });
  domainConfigs.set(SQS_CONFIG, { queues: state.sqs });
  domainConfigs.set(SNS_CONFIG, { topics: state.sns });
  domainConfigs.set(EVENTBRIDGE_CONFIG, { eventBuses: state.eventbridge ?? {} });
  domainConfigs.set(APIS_CONFIG, { restApi: undefined });
  domainConfigs.set(CLOUDFRONT_CONFIG, {
    cachePolicies: state.cloudfront.cachePolicies,
    originRequestPolicies: state.cloudfront.originRequestPolicies,
    distributions: state.cloudfront.distributions,
  });
}
