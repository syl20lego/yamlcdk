import type { DomainPlugin } from "../compiler/plugins/index.js";
import { DomainRegistry } from "../compiler/plugins/registry.js";
import { nativeDomainsFromManifest } from "./manifest.js";

export {
  type DomainDescriptor,
  type DomainDescriptorWithConfig,
  type DomainDescriptorWithoutConfig,
  type DomainEventBindingContract,
  type DomainLifecycleRole,
  type DomainYamlcdkSectionNamespace,
  type DomainYamlcdkSectionRegistration,
  hasDomainConfigKey,
} from "./contracts.js";

export {
  domainManifest,
  orderedDomainManifest,
  nativeDomainsFromManifest,
} from "./manifest.js";

export { s3Domain } from "./s3/compiler.js";
export { dynamodbDomain } from "./dynamodb/compiler.js";
export { sqsDomain } from "./sqs/compiler.js";
export { snsDomain } from "./sns/compiler.js";
export { eventbridgeDomain } from "./eventbridge/compiler.js";
export { functionsDomain } from "./functions/compiler.js";
export { apisDomain } from "./apis/compiler.js";
export { cloudfrontDomain } from "./cloudfront/compiler.js";

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
