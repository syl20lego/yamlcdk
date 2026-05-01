import * as cdk from "aws-cdk-lib";
import * as opensearchserverless from "aws-cdk-lib/aws-opensearchserverless";
import { withStageName } from "../../compiler/stack/helpers.js";
import type {
  DomainPlugin,
  DomainValidationContribution,
} from "../../compiler/plugins/index.js";
import {
  OPENSEARCH_SERVERLESS_CONFIG,
  type OpenSearchCollectionConfig,
  type OpenSearchPolicyDocument,
  type OpenSearchSecurityPolicyConfig,
  type TokenString,
} from "./model.js";

function sanitizeCollectionName(value: string): string {
  return value.replace(/[^a-zA-Z0-9-]/g, "-").toLowerCase();
}

function toTokenString(value: TokenString): string {
  if (typeof value === "string") return value;
  return cdk.Token.asString(value as unknown as cdk.IResolvable);
}

function toTokenStringArray(values: readonly TokenString[]): string[] {
  return values.map((value) => toTokenString(value));
}

function toCfnTags(
  tags: Record<string, string> | undefined,
): cdk.CfnTag[] | undefined {
  if (!tags) return undefined;
  return Object.entries(tags).map(([key, value]) => ({ key, value }));
}

function isIntrinsicObject(value: unknown): boolean {
  if (value === null || typeof value !== "object" || Array.isArray(value)) {
    return false;
  }
  return Object.keys(value).some((key) => key === "Ref" || key.startsWith("Fn::"));
}

function toPolicyString(policy: OpenSearchPolicyDocument): string {
  if (typeof policy === "string") return policy;
  if (isIntrinsicObject(policy)) {
    return cdk.Token.asString(policy as unknown as cdk.IResolvable);
  }
  return JSON.stringify(policy);
}

function toCollectionName(
  key: string,
  stage: string,
  collection: OpenSearchCollectionConfig,
): string {
  if (collection.name) {
    return toTokenString(collection.name);
  }
  return sanitizeCollectionName(withStageName(key, stage));
}

function policyTargetsCollection(policyText: string, collectionName: string): boolean {
  const marker = collectionName.toLowerCase();
  const lowered = policyText.toLowerCase();
  return (
    lowered.includes(`collection/${marker}`) ||
    lowered.includes(`index/${marker}/`) ||
    lowered.includes(`collection/${marker}*`) ||
    lowered.includes(`index/${marker}/*`)
  );
}

function buildDefaultEncryptionPolicy(collectionName: string): string {
  return JSON.stringify([
    {
      Rules: [
        {
          ResourceType: "collection",
          Resource: [`collection/${collectionName}`],
        },
      ],
      AWSOwnedKey: true,
    },
  ]);
}

function buildDefaultAccessPolicy(collectionName: string): string {
  const policyTemplate = JSON.stringify([
    {
      Rules: [
        {
          ResourceType: "collection",
          Resource: [`collection/${collectionName}`],
          Permission: ["aoss:*"],
        },
        {
          ResourceType: "index",
          Resource: [`index/${collectionName}/*`],
          Permission: ["aoss:*"],
        },
      ],
      Principal: ["arn:aws:iam::${AWS::AccountId}:root"],
    },
  ]);
  return cdk.Fn.sub(policyTemplate);
}

function hasEncryptionPolicyForCollection(
  securityPolicies: Record<string, OpenSearchSecurityPolicyConfig>,
  collectionName: string,
): boolean {
  return Object.values(securityPolicies).some((policy) => {
    if (policy.type.toLowerCase() !== "encryption") return false;
    return policyTargetsCollection(toPolicyString(policy.policy), collectionName);
  });
}

function hasAccessPolicyForCollection(
  accessPolicies: Record<
    string,
    { policy: OpenSearchPolicyDocument }
  >,
  collectionName: string,
): boolean {
  return Object.values(accessPolicies).some((policy) =>
    policyTargetsCollection(toPolicyString(policy.policy), collectionName),
  );
}

export const opensearchserverlessDomain: DomainPlugin = {
  name: "opensearchserverless",

  synthesize(ctx) {
    const config = ctx.model.domainConfigs.get(OPENSEARCH_SERVERLESS_CONFIG);
    if (!config) return;

    const stage = ctx.model.provider.stage;
    const collectionNames = new Map<string, string>();
    for (const [key, collection] of Object.entries(config.collections)) {
      collectionNames.set(key, toCollectionName(key, stage, collection));
    }

    const autoEncryptionPolicies = new Map<
      string,
      opensearchserverless.CfnSecurityPolicy
    >();

    // Explicit security policies first.
    for (const [key, policy] of Object.entries(config.securityPolicies)) {
      const policyResource = new opensearchserverless.CfnSecurityPolicy(
        ctx.stack,
        `OpenSearchSecurityPolicy${key}`,
        {
          name: policy.name ? toTokenString(policy.name) : key,
          description: policy.description,
          type: policy.type,
          policy: toPolicyString(policy.policy),
        },
      );
      ctx.refs[key] = policyResource;
      ctx.availableOutputs.set(`${key}OpenSearchSecurityPolicyRef`, policyResource.ref);
    }

    // Explicit access policies.
    for (const [key, policy] of Object.entries(config.accessPolicies)) {
      const policyResource = new opensearchserverless.CfnAccessPolicy(
        ctx.stack,
        `OpenSearchAccessPolicy${key}`,
        {
          name: policy.name ? toTokenString(policy.name) : key,
          description: policy.description,
          type: policy.type,
          policy: toPolicyString(policy.policy),
        },
      );
      ctx.refs[key] = policyResource;
      ctx.availableOutputs.set(`${key}OpenSearchAccessPolicyRef`, policyResource.ref);
    }

    // Explicit VPC endpoints.
    for (const [key, endpoint] of Object.entries(config.vpcEndpoints)) {
      const endpointResource = new opensearchserverless.CfnVpcEndpoint(
        ctx.stack,
        `OpenSearchVpcEndpoint${key}`,
        {
          name: endpoint.name ? toTokenString(endpoint.name) : withStageName(key, stage),
          vpcId: toTokenString(endpoint.vpcId),
          subnetIds: toTokenStringArray(endpoint.subnetIds),
          securityGroupIds: endpoint.securityGroupIds
            ? toTokenStringArray(endpoint.securityGroupIds)
            : undefined,
        },
      );
      ctx.refs[key] = endpointResource;
      ctx.availableOutputs.set(`${key}OpenSearchVpcEndpointId`, endpointResource.attrId);
    }

    if (config.autoCreatePolicies) {
      for (const [key, collectionName] of collectionNames.entries()) {
        if (
          !hasEncryptionPolicyForCollection(config.securityPolicies, collectionName)
        ) {
          const encryptionPolicy = new opensearchserverless.CfnSecurityPolicy(
            ctx.stack,
            `OpenSearchAutoEncryptionPolicy${key}`,
            {
              name: `${collectionName}-encryption`,
              type: "encryption",
              policy: buildDefaultEncryptionPolicy(collectionName),
            },
          );
          autoEncryptionPolicies.set(key, encryptionPolicy);
        }

        if (!hasAccessPolicyForCollection(config.accessPolicies, collectionName)) {
          new opensearchserverless.CfnAccessPolicy(
            ctx.stack,
            `OpenSearchAutoAccessPolicy${key}`,
            {
              name: `${collectionName}-data`,
              type: "data",
              policy: buildDefaultAccessPolicy(collectionName),
            },
          );
        }
      }
    }

    // Collections last so generated encryption policies can be dependency targets.
    for (const [key, collection] of Object.entries(config.collections)) {
      const collectionName = collectionNames.get(key)!;
      const collectionResource = new opensearchserverless.CfnCollection(
        ctx.stack,
        `OpenSearchCollection${key}`,
        {
          name: collectionName,
          description: collection.description,
          type: collection.type,
          standbyReplicas: collection.standbyReplicas,
          collectionGroupName: collection.collectionGroupName,
          encryptionConfig: collection.encryptionConfig as
            | opensearchserverless.CfnCollection.EncryptionConfigProperty
            | cdk.IResolvable
            | undefined,
          vectorOptions: collection.vectorOptions as
            | opensearchserverless.CfnCollection.VectorOptionsProperty
            | cdk.IResolvable
            | undefined,
          tags: toCfnTags(collection.tags),
        },
      );

      const autoEncryptionPolicy = autoEncryptionPolicies.get(key);
      if (autoEncryptionPolicy) {
        collectionResource.addDependency(autoEncryptionPolicy);
      }

      ctx.refs[key] = collectionResource;
      ctx.availableOutputs.set(`${key}CollectionArn`, collectionResource.attrArn);
      ctx.availableOutputs.set(`${key}CollectionId`, collectionResource.attrId);
      ctx.availableOutputs.set(
        `${key}CollectionEndpoint`,
        collectionResource.attrCollectionEndpoint,
      );
      ctx.availableOutputs.set(
        `${key}DashboardEndpoint`,
        collectionResource.attrDashboardEndpoint,
      );
      ctx.availableOutputs.set(`${key}KmsKeyArn`, collectionResource.attrKmsKeyArn);
    }
  },

  describeValidation(ctx) {
    const config = ctx.model.domainConfigs.get(OPENSEARCH_SERVERLESS_CONFIG);
    if (!config) return [];

    const contributions: DomainValidationContribution[] = [];
    for (const [name, collection] of Object.entries(config.collections)) {
      contributions.push({
        section: "Resources",
        description: `OpenSearch Serverless collection "${name}"`,
        properties: {
          name: collection.name ?? name,
          type: collection.type ?? "SEARCH",
          standbyReplicas: collection.standbyReplicas ?? "DISABLED",
          autoCreatePolicies: config.autoCreatePolicies,
        },
        status: "valid",
      });
    }
    return contributions;
  },
};
