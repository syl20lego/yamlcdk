/**
 * Adapt a CloudFormation template into the canonical {@link ServiceModel}.
 *
 * Extracts supported AWS resource types (Lambda, S3, DynamoDB, SQS, SNS,
 * EventBridge, API Gateway V2) and maps them to the compiler model.
 * Cross-resource wiring (EventSourceMappings, S3 notifications,
 * EventBridge targets, API routes) is resolved via logical ID lookups.
 */

import fs from "node:fs";
import path from "node:path";
import type {
  ServiceModel,
  EventDeclaration,
  FunctionModel,
} from "../../compiler/model.js";
import { parseServiceModel } from "../../compiler/model.js";
import { DomainConfigs } from "../../compiler/plugins/domain-configs.js";
import {
  S3_CONFIG,
  DYNAMODB_CONFIG,
  SQS_CONFIG,
  SNS_CONFIG,
  APIS_CONFIG,
} from "../../compiler/plugins/native-domain-configs.js";
import type {
  S3BucketConfig,
  DynamoDBTableConfig,
  SQSQueueConfig,
  SNSTopicConfig,
  SNSSubscriptionConfig,
} from "../../compiler/plugins/native-domain-configs.js";
import { isCfnRef, resolveLogicalId } from "./cfn-yaml.js";

// ─── CloudFormation template types ──────────────────────────

interface CfnResource {
  Type: string;
  Properties?: Record<string, unknown>;
  DependsOn?: string | string[];
}

interface YamlcdkMetadata {
  service?: string;
  stage?: string;
  region?: string;
  account?: string;
  profile?: string;
  tags?: Record<string, string>;
  s3?: { cleanupRoleArn?: string };
  restApi?: { apiKeyRequired?: boolean; cloudWatchRoleArn?: string };
  deployment?: Record<string, unknown>;
}

interface CfnTemplate {
  AWSTemplateFormatVersion?: string;
  Description?: string;
  Metadata?: { yamlcdk?: YamlcdkMetadata; [k: string]: unknown };
  Parameters?: Record<string, unknown>;
  Resources?: Record<string, CfnResource>;
  Outputs?: Record<string, unknown>;
}

// ─── Helpers ────────────────────────────────────────────────

function getResourcesByType(
  resources: Record<string, CfnResource>,
  type: string,
): [string, CfnResource][] {
  return Object.entries(resources).filter(([, r]) => r.Type === type);
}

function props(resource: CfnResource): Record<string, unknown> {
  return resource.Properties ?? {};
}

/** Build a map of logical ID → resource type. */
function buildResourceTypeMap(
  resources: Record<string, CfnResource>,
): Map<string, string> {
  const map = new Map<string, string>();
  for (const [id, r] of Object.entries(resources)) {
    map.set(id, r.Type);
  }
  return map;
}

/** Map CF attribute type string to yamlcdk key type. */
function toDynamoKeyType(
  cfnType: string,
): "string" | "number" | "binary" {
  switch (cfnType) {
    case "S":
      return "string";
    case "N":
      return "number";
    case "B":
      return "binary";
    default:
      return "string";
  }
}

/**
 * Extract an integration logical ID from a Route's Target property.
 * Handles both `!Ref IntegrationId` and
 * `!Join ["/", ["integrations", !Ref IntegrationId]]`.
 */
function extractIntegrationRef(target: unknown): string | undefined {
  if (isCfnRef(target)) return target.Ref;
  if (
    target &&
    typeof target === "object" &&
    "Fn::Join" in target
  ) {
    const join = (target as { "Fn::Join": [string, unknown[]] })["Fn::Join"];
    const parts = join[1];
    if (Array.isArray(parts)) {
      for (const part of parts) {
        const id = resolveLogicalId(part);
        if (id) return id;
      }
    }
  }
  return undefined;
}

// ─── Resource extractors ────────────────────────────────────

function extractFunctions(
  resources: Record<string, CfnResource>,
): Record<string, FunctionModel> {
  const functions: Record<string, FunctionModel> = {};

  for (const [logicalId, resource] of getResourcesByType(
    resources,
    "AWS::Lambda::Function",
  )) {
    const p = props(resource);
    const env =
      p.Environment &&
      typeof p.Environment === "object" &&
      "Variables" in (p.Environment as Record<string, unknown>)
        ? ((p.Environment as Record<string, unknown>).Variables as Record<
            string,
            string
          >)
        : undefined;

    const handler = (p.Handler as string) ?? "index.handler";
    const [modulePath] = handler.split(".");
    const absTs = path.resolve(process.cwd(), modulePath + ".ts");
    const buildMode = fs.existsSync(absTs) ? "typescript" : "none";

    functions[logicalId] = {
      handler,
      runtime: (p.Runtime as string) ?? undefined,
      timeout:
        typeof p.Timeout === "number" ? p.Timeout : undefined,
      memorySize:
        typeof p.MemorySize === "number" ? p.MemorySize : undefined,
      environment: env,
      build: { mode: buildMode },
      events: [],
    };
  }

  return functions;
}

function extractS3Buckets(
  resources: Record<string, CfnResource>,
): Record<string, S3BucketConfig> {
  const buckets: Record<string, S3BucketConfig> = {};

  for (const [logicalId, resource] of getResourcesByType(
    resources,
    "AWS::S3::Bucket",
  )) {
    const p = props(resource);
    const versioning =
      p.VersioningConfiguration &&
      typeof p.VersioningConfiguration === "object" &&
      (p.VersioningConfiguration as Record<string, unknown>).Status ===
        "Enabled";

    buckets[logicalId] = {
      versioned: versioning ? true : undefined,
    };
  }

  return buckets;
}

function extractDynamoDBTables(
  resources: Record<string, CfnResource>,
): Record<string, DynamoDBTableConfig> {
  const tables: Record<string, DynamoDBTableConfig> = {};

  for (const [logicalId, resource] of getResourcesByType(
    resources,
    "AWS::DynamoDB::Table",
  )) {
    const p = props(resource);

    const attrDefs = (p.AttributeDefinitions as
      | Array<{ AttributeName: string; AttributeType: string }>
      | undefined) ?? [];
    const keySchema = (p.KeySchema as
      | Array<{ AttributeName: string; KeyType: string }>
      | undefined) ?? [];

    const hashKey = keySchema.find((k) => k.KeyType === "HASH");
    const rangeKey = keySchema.find((k) => k.KeyType === "RANGE");

    if (!hashKey) continue; // skip tables without a partition key

    const hashAttr = attrDefs.find(
      (a) => a.AttributeName === hashKey.AttributeName,
    );
    const rangeAttr = rangeKey
      ? attrDefs.find((a) => a.AttributeName === rangeKey.AttributeName)
      : undefined;

    const streamSpec = p.StreamSpecification as
      | { StreamViewType?: string }
      | undefined;

    tables[logicalId] = {
      partitionKey: {
        name: hashKey.AttributeName,
        type: toDynamoKeyType(hashAttr?.AttributeType ?? "S"),
      },
      sortKey: rangeAttr
        ? {
            name: rangeKey!.AttributeName,
            type: toDynamoKeyType(rangeAttr.AttributeType),
          }
        : undefined,
      billingMode:
        (p.BillingMode as "PAY_PER_REQUEST" | "PROVISIONED" | undefined) ??
        undefined,
      stream: (streamSpec?.StreamViewType as
        | "NEW_IMAGE"
        | "OLD_IMAGE"
        | "NEW_AND_OLD_IMAGES"
        | "KEYS_ONLY"
        | undefined) ?? undefined,
    };
  }

  return tables;
}

function extractSQSQueues(
  resources: Record<string, CfnResource>,
): Record<string, SQSQueueConfig> {
  const queues: Record<string, SQSQueueConfig> = {};

  for (const [logicalId, resource] of getResourcesByType(
    resources,
    "AWS::SQS::Queue",
  )) {
    const p = props(resource);
    queues[logicalId] = {
      visibilityTimeout:
        typeof p.VisibilityTimeout === "number"
          ? p.VisibilityTimeout
          : undefined,
    };
  }

  return queues;
}

function extractSNSTopics(
  resources: Record<string, CfnResource>,
  snsSubscriptions: Array<{
    topicLogicalId: string;
    protocol: string;
    endpointLogicalId: string;
  }>,
): Record<string, SNSTopicConfig> {
  const topics: Record<string, SNSTopicConfig> = {};

  for (const [logicalId] of getResourcesByType(
    resources,
    "AWS::SNS::Topic",
  )) {
    const subs = snsSubscriptions
      .filter(
        (s) => s.topicLogicalId === logicalId && s.protocol === "sqs",
      )
      .map(
        (s): SNSSubscriptionConfig => ({
          type: "sqs",
          target: s.endpointLogicalId,
        }),
      );

    topics[logicalId] = {
      subscriptions: subs.length > 0 ? subs : undefined,
    };
  }

  return topics;
}

// ─── Event wiring ───────────────────────────────────────────

function wireEventSourceMappings(
  resources: Record<string, CfnResource>,
  functions: Record<string, FunctionModel>,
  resourceTypes: Map<string, string>,
): void {
  for (const [, resource] of getResourcesByType(
    resources,
    "AWS::Lambda::EventSourceMapping",
  )) {
    const p = props(resource);
    const fnId = resolveLogicalId(p.FunctionName);
    if (!fnId || !functions[fnId]) continue;

    const sourceId = resolveLogicalId(p.EventSourceArn);
    if (!sourceId) continue;

    const sourceType = resourceTypes.get(sourceId);
    const batchSize =
      typeof p.BatchSize === "number" ? p.BatchSize : undefined;

    if (sourceType === "AWS::SQS::Queue") {
      functions[fnId].events.push({
        type: "sqs",
        queue: sourceId,
        batchSize,
      });
    } else if (sourceType === "AWS::DynamoDB::Table") {
      const startingPosition = (p.StartingPosition as string) ?? undefined;
      functions[fnId].events.push({
        type: "dynamodb-stream",
        table: sourceId,
        batchSize,
        startingPosition,
      });
    }
  }
}

function extractSNSSubscriptions(
  resources: Record<string, CfnResource>,
  resourceTypes: Map<string, string>,
): Array<{
  topicLogicalId: string;
  protocol: string;
  endpointLogicalId: string;
}> {
  const subscriptions: Array<{
    topicLogicalId: string;
    protocol: string;
    endpointLogicalId: string;
  }> = [];

  for (const [, resource] of getResourcesByType(
    resources,
    "AWS::SNS::Subscription",
  )) {
    const p = props(resource);
    const topicId = resolveLogicalId(p.TopicArn);
    const endpointId = resolveLogicalId(p.Endpoint);
    const protocol = p.Protocol as string | undefined;

    if (!topicId || !endpointId || !protocol) continue;

    const endpointType = resourceTypes.get(endpointId);

    // Lambda subscription → event on function
    if (protocol === "lambda" && endpointType === "AWS::Lambda::Function") {
      subscriptions.push({ topicLogicalId: topicId, protocol: "lambda", endpointLogicalId: endpointId });
      continue;
    }

    // SQS subscription → topic config
    if (protocol === "sqs" && endpointType === "AWS::SQS::Queue") {
      subscriptions.push({ topicLogicalId: topicId, protocol: "sqs", endpointLogicalId: endpointId });
    }
  }

  return subscriptions;
}

function wireSNSLambdaSubscriptions(
  subscriptions: Array<{
    topicLogicalId: string;
    protocol: string;
    endpointLogicalId: string;
  }>,
  functions: Record<string, FunctionModel>,
): void {
  for (const sub of subscriptions) {
    if (sub.protocol === "lambda" && functions[sub.endpointLogicalId]) {
      functions[sub.endpointLogicalId].events.push({
        type: "sns",
        topic: sub.topicLogicalId,
      });
    }
  }
}

function wireS3Notifications(
  resources: Record<string, CfnResource>,
  functions: Record<string, FunctionModel>,
): void {
  for (const [logicalId, resource] of getResourcesByType(
    resources,
    "AWS::S3::Bucket",
  )) {
    const p = props(resource);
    const notifConfig = p.NotificationConfiguration as
      | { LambdaConfigurations?: Array<{ Event: string; Function: unknown }> }
      | undefined;
    if (!notifConfig?.LambdaConfigurations) continue;

    for (const lambdaConfig of notifConfig.LambdaConfigurations) {
      const fnId = resolveLogicalId(lambdaConfig.Function);
      if (!fnId || !functions[fnId]) continue;

      functions[fnId].events.push({
        type: "s3",
        bucket: logicalId,
        events: [lambdaConfig.Event],
      });
    }
  }
}

function wireEventBridgeRules(
  resources: Record<string, CfnResource>,
  functions: Record<string, FunctionModel>,
): void {
  for (const [, resource] of getResourcesByType(
    resources,
    "AWS::Events::Rule",
  )) {
    const p = props(resource);
    const targets = p.Targets as
      | Array<{ Arn: unknown; Id?: string }>
      | undefined;
    if (!targets) continue;

    for (const target of targets) {
      const fnId = resolveLogicalId(target.Arn);
      if (!fnId || !functions[fnId]) continue;

      const event: EventDeclaration = {
        type: "eventbridge",
        schedule:
          typeof p.ScheduleExpression === "string"
            ? p.ScheduleExpression
            : undefined,
        eventPattern:
          p.EventPattern &&
          typeof p.EventPattern === "object"
            ? (p.EventPattern as Record<string, unknown>)
            : undefined,
      };
      functions[fnId].events.push(event);
    }
  }
}

function wireHttpApiRoutes(
  resources: Record<string, CfnResource>,
  functions: Record<string, FunctionModel>,
): void {
  // Build integration → function map
  const integrationToFunction = new Map<string, string>();
  for (const [logicalId, resource] of getResourcesByType(
    resources,
    "AWS::ApiGatewayV2::Integration",
  )) {
    const p = props(resource);
    const fnId = resolveLogicalId(p.IntegrationUri);
    if (fnId) {
      integrationToFunction.set(logicalId, fnId);
    }
  }

  // Wire routes
  for (const [, resource] of getResourcesByType(
    resources,
    "AWS::ApiGatewayV2::Route",
  )) {
    const p = props(resource);
    const routeKey = p.RouteKey as string | undefined;
    if (!routeKey || routeKey === "$default") continue;

    const integrationId = extractIntegrationRef(p.Target);
    if (!integrationId) continue;

    const fnId = integrationToFunction.get(integrationId);
    if (!fnId || !functions[fnId]) continue;

    // RouteKey format: "METHOD /path"
    const spaceIdx = routeKey.indexOf(" ");
    if (spaceIdx === -1) continue;

    const method = routeKey.slice(0, spaceIdx);
    const path = routeKey.slice(spaceIdx + 1);

    functions[fnId].events.push({
      type: "http",
      method,
      path,
    });
  }
}

// ─── Main adaptation ────────────────────────────────────────

function sanitizeName(input: string): string {
  return input.replace(/[^a-zA-Z0-9-]/g, "-").toLowerCase();
}

export function adaptCfnTemplate(
  parsed: unknown,
  filePath: string,
): ServiceModel {
  const template = parsed as CfnTemplate;
  const allResources = template.Resources ?? {};
  const resourceTypes = buildResourceTypeMap(allResources);
  const meta = template.Metadata?.yamlcdk ?? {};

  // Derive service name
  const service =
    meta.service ??
    (filePath
      .replace(/^.*[\\/]/, "")
      .replace(/\.(yml|yaml|template|cfn)$/gi, "")
      .replace(/\.(yml|yaml)$/i, "") || "service");

  const stage = meta.stage ?? "dev";
  const region =
    meta.region ?? process.env.AWS_REGION ?? "us-east-1";
  const stackName = `${sanitizeName(service)}-${sanitizeName(stage)}`;

  // Extract resources
  const functions = extractFunctions(allResources);
  const buckets = extractS3Buckets(allResources);
  const tables = extractDynamoDBTables(allResources);
  const queues = extractSQSQueues(allResources);
  const snsSubscriptions = extractSNSSubscriptions(
    allResources,
    resourceTypes,
  );
  const topics = extractSNSTopics(allResources, snsSubscriptions);

  // Wire events to functions
  wireEventSourceMappings(allResources, functions, resourceTypes);
  wireSNSLambdaSubscriptions(snsSubscriptions, functions);
  wireS3Notifications(allResources, functions);
  wireEventBridgeRules(allResources, functions);
  wireHttpApiRoutes(allResources, functions);

  // Build domain configs
  const dc = new DomainConfigs();

  dc.set(S3_CONFIG, {
    buckets,
    cleanupRoleArn: meta.s3?.cleanupRoleArn,
  });
  dc.set(DYNAMODB_CONFIG, { tables });
  dc.set(SQS_CONFIG, { queues });
  dc.set(SNS_CONFIG, { topics });
  dc.set(APIS_CONFIG, {
    restApi: meta.restApi?.cloudWatchRoleArn
      ? { cloudWatchRoleArn: meta.restApi.cloudWatchRoleArn }
      : undefined,
  });

  return parseServiceModel({
    service,
    stackName,
    provider: {
      region,
      stage,
      account: meta.account,
      profile: meta.profile,
      tags: meta.tags,
      deployment: meta.deployment,
    },
    functions,
    iam: { statements: {} },
    domainConfigs: dc,
  });
}
