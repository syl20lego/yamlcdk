import type { DomainPlugin } from "../compiler/plugins/domain-plugin.js";
import {
  APIS_CONFIG,
} from "./apis/model.js";
import {
  CLOUDFRONT_CONFIG,
  cloudfrontYamlcdkCachePoliciesSchema,
  cloudfrontYamlcdkDistributionsSchema,
  cloudfrontYamlcdkOriginRequestPoliciesSchema,
} from "./cloudfront/model.js";
import {
  DYNAMODB_CONFIG,
  dynamodbYamlcdkStorageSchema,
} from "./dynamodb/model.js";
import {
  S3_CONFIG,
  s3YamlcdkStorageSchema,
} from "./s3/model.js";
import {
  SNS_CONFIG,
  snsYamlcdkMessagingSchema,
} from "./sns/model.js";
import {
  SQS_CONFIG,
  sqsYamlcdkMessagingSchema,
} from "./sqs/model.js";
import {
  EVENTBRIDGE_CONFIG,
  eventbridgeYamlcdkMessagingSchema,
} from "./eventbridge/model.js";
import { apisDomain } from "./apis/compiler.js";
import { cloudfrontDomain } from "./cloudfront/compiler.js";
import { dynamodbDomain } from "./dynamodb/compiler.js";
import { eventbridgeDomain } from "./eventbridge/compiler.js";
import { functionsDomain } from "./functions/compiler.js";
import { s3Domain } from "./s3/compiler.js";
import { snsDomain } from "./sns/compiler.js";
import { sqsDomain } from "./sqs/compiler.js";
import type { DomainDescriptor } from "./contracts.js";

export const domainManifest: readonly DomainDescriptor[] = [
  {
    id: "s3",
    order: 10,
    role: "resource",
    plugin: s3Domain,
    configKey: S3_CONFIG,
    yamlcdkSections: [
      {
        namespace: "storage",
        key: "s3",
        schema: s3YamlcdkStorageSchema,
        createDefault: () => ({}),
      },
    ],
  },
  {
    id: "dynamodb",
    order: 20,
    role: "resource",
    plugin: dynamodbDomain,
    configKey: DYNAMODB_CONFIG,
    yamlcdkSections: [
      {
        namespace: "storage",
        key: "dynamodb",
        schema: dynamodbYamlcdkStorageSchema,
        createDefault: () => ({}),
      },
    ],
  },
  {
    id: "sqs",
    order: 30,
    role: "resource",
    plugin: sqsDomain,
    configKey: SQS_CONFIG,
    yamlcdkSections: [
      {
        namespace: "messaging",
        key: "sqs",
        schema: sqsYamlcdkMessagingSchema,
        createDefault: () => ({}),
      },
    ],
  },
  {
    id: "sns",
    order: 40,
    role: "resource",
    plugin: snsDomain,
    configKey: SNS_CONFIG,
    yamlcdkSections: [
      {
        namespace: "messaging",
        key: "sns",
        schema: snsYamlcdkMessagingSchema,
        createDefault: () => ({}),
      },
    ],
  },
  {
    id: "functions",
    order: 50,
    role: "functions",
    plugin: functionsDomain,
    eventBindings: { produces: true, consumes: false },
  },
  {
    id: "eventbridge",
    order: 60,
    role: "binding",
    plugin: eventbridgeDomain,
    configKey: EVENTBRIDGE_CONFIG,
    yamlcdkSections: [
      {
        namespace: "messaging",
        key: "eventbridge",
        schema: eventbridgeYamlcdkMessagingSchema,
        createDefault: () => ({}),
      },
    ],
    eventBindings: { produces: false, consumes: true },
  },
  {
    id: "apis",
    order: 70,
    role: "binding",
    plugin: apisDomain,
    configKey: APIS_CONFIG,
    eventBindings: { produces: false, consumes: true },
  },
  {
    id: "cloudfront",
    order: 80,
    role: "resource",
    plugin: cloudfrontDomain,
    configKey: CLOUDFRONT_CONFIG,
    yamlcdkSections: [
      {
        namespace: "cdn",
        key: "cachePolicies",
        schema: cloudfrontYamlcdkCachePoliciesSchema,
        createDefault: () => ({}),
      },
      {
        namespace: "cdn",
        key: "originRequestPolicies",
        schema: cloudfrontYamlcdkOriginRequestPoliciesSchema,
        createDefault: () => ({}),
      },
      {
        namespace: "cdn",
        key: "distributions",
        schema: cloudfrontYamlcdkDistributionsSchema,
        createDefault: () => ({}),
      },
    ],
  },
];

function assertUniqueDomainManifest(
  descriptors: readonly DomainDescriptor[],
): void {
  const ids = new Set<string>();
  const names = new Set<string>();
  const orders = new Set<number>();

  for (const descriptor of descriptors) {
    if (ids.has(descriptor.id)) {
      throw new Error(`Duplicate domain descriptor id "${descriptor.id}".`);
    }
    ids.add(descriptor.id);

    if (orders.has(descriptor.order)) {
      throw new Error(
        `Duplicate domain descriptor order "${descriptor.order}" for "${descriptor.id}".`,
      );
    }
    orders.add(descriptor.order);

    if (names.has(descriptor.plugin.name)) {
      throw new Error(
        `Duplicate domain plugin name "${descriptor.plugin.name}" in domain manifest.`,
      );
    }
    names.add(descriptor.plugin.name);
  }
}

assertUniqueDomainManifest(domainManifest);

export const orderedDomainManifest: readonly DomainDescriptor[] = [
  ...domainManifest,
].sort((a, b) => a.order - b.order);

export const nativeDomainsFromManifest: readonly DomainPlugin[] =
  orderedDomainManifest.map((descriptor) => descriptor.plugin);
