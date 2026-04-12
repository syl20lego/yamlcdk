import type { DomainPlugin } from "../plugins/index.js";
import { DomainRegistry } from "../plugins/registry.js";
import { s3Domain } from "./s3.js";
import { dynamodbDomain } from "./dynamodb.js";
import { sqsDomain } from "./sqs.js";
import { snsDomain } from "./sns.js";
import { eventbridgeDomain } from "./eventbridge.js";
import { functionsDomain } from "./functions.js";
import { apisDomain } from "./apis.js";
import { cloudfrontDomain } from "./cloudfront.js";

/** All native domain plugins in recommended registration order. */
export const nativeDomains: readonly DomainPlugin[] = [
  s3Domain,
  dynamodbDomain,
  sqsDomain,
  snsDomain,
  functionsDomain,
  eventbridgeDomain,
  apisDomain,
  cloudfrontDomain,
];

/** Create a DomainRegistry pre-loaded with all native domains. */
export function createNativeDomainRegistry(): DomainRegistry {
  const registry = new DomainRegistry();
  for (const domain of nativeDomains) {
    registry.register(domain);
  }
  return registry;
}

export {
  s3Domain,
  dynamodbDomain,
  sqsDomain,
  snsDomain,
  eventbridgeDomain,
  functionsDomain,
  apisDomain,
  cloudfrontDomain,
};
