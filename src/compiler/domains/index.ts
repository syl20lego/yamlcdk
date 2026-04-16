import type { DomainPlugin } from "../plugins/index.js";
import { DomainRegistry } from "../plugins/registry.js";
import { nativeDomainsFromManifest } from "../../domains/manifest.js";

/** All native domain plugins in recommended registration order. */
export const nativeDomains: readonly DomainPlugin[] = nativeDomainsFromManifest;

/** Create a DomainRegistry pre-loaded with all native domains. */
export function createNativeDomainRegistry(): DomainRegistry {
  const registry = new DomainRegistry();
  for (const domain of nativeDomains) {
    registry.register(domain);
  }
  return registry;
}

export { s3Domain } from "../../domains/s3/compiler.js";
export { dynamodbDomain } from "../../domains/dynamodb/compiler.js";
export { sqsDomain } from "../../domains/sqs/compiler.js";
export { snsDomain } from "../../domains/sns/compiler.js";
export { eventbridgeDomain } from "../../domains/eventbridge/compiler.js";
export { functionsDomain } from "../../domains/functions/compiler.js";
export { apisDomain } from "../../domains/apis/compiler.js";
export { cloudfrontDomain } from "../../domains/cloudfront/compiler.js";

export {
  domainManifest as nativeDomainManifest,
  orderedDomainManifest,
} from "../../domains/manifest.js";

export type {
  DomainDescriptor,
  DomainDescriptorWithConfig,
  DomainDescriptorWithoutConfig,
  DomainLifecycleRole,
} from "../../domains/contracts.js";
