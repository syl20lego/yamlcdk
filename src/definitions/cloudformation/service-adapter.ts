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
import type {FunctionModel, FunctionUrlConfig, ServiceModel,} from "../../compiler/model.js";
import {parseServiceModel} from "../../compiler/model.js";
import type {
  CloudFrontCachePolicyConfig,
  CloudFrontDistributionConfig,
  CloudFrontOriginRequestPolicyConfig,
  DynamoDBTableConfig,
  S3BucketConfig,
  SNSSubscriptionConfig,
  SNSTopicConfig,
  SQSQueueConfig,
} from "../../compiler/plugins/index.js";
import {
  adaptDomainConfigsFromCloudFormation,
} from "./domain-adapters.js";
import type { CloudFormationDomainConfigInput } from "../domain-adapter-types.js";
import {
  createDynamodbStreamEvent,
  createEventBridgeEvent,
  createHttpEvent,
  createS3Event,
  createSnsEvent,
  createSqsEvent,
} from "../shared-event-adapters.js";
import {isCfnRef, resolveLogicalId} from "./cfn-yaml.js";

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

type SNSSubscriptionOptionValues = {
  deliveryPolicy?: Record<string, unknown>;
  filterPolicy?: Record<string, unknown>;
  filterPolicyScope?: "MessageAttributes" | "MessageBody";
  rawMessageDelivery?: boolean;
  redrivePolicy?: Record<string, unknown>;
  region?: string;
  replayPolicy?: Record<string, unknown> | string;
  subscriptionRoleArn?: string;
};

interface ExtractedSNSSubscription {
  topicLogicalId: string;
  protocol: string;
  subscription: SNSSubscriptionConfig;
  endpointLogicalId?: string;
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

function toStringArray(
  value: unknown,
  description: string,
): string[] | undefined {
  if (value === undefined) return undefined;
  if (!Array.isArray(value) || value.some((entry) => typeof entry !== "string")) {
    throw new Error(`${description} must be an array of strings.`);
  }
  return value.length > 0 ? value : undefined;
}

type FunctionUrlAllowedMethod = NonNullable<
  NonNullable<FunctionUrlConfig["cors"]>["allowedMethods"]
>[number];

const functionUrlAllowedMethods = new Set<FunctionUrlAllowedMethod>([
  "GET",
  "PUT",
  "HEAD",
  "POST",
  "DELETE",
  "PATCH",
  "OPTIONS",
  "*",
]);

function toFunctionUrlMethods(
  value: unknown,
  description: string,
): FunctionUrlAllowedMethod[] | undefined {
  const methods = toStringArray(value, description);
  if (!methods) return undefined;

  const invalidMethod = methods.find(
    (method) => !functionUrlAllowedMethods.has(method as FunctionUrlAllowedMethod),
  );
  if (invalidMethod) {
    throw new Error(
      `${description} includes unsupported method "${invalidMethod}".`,
    );
  }

  return methods as FunctionUrlAllowedMethod[];
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
  snsSubscriptions: ExtractedSNSSubscription[],
): Record<string, SNSTopicConfig> {
  const topics: Record<string, SNSTopicConfig> = {};

  for (const [logicalId, resource] of getResourcesByType(
    resources,
    "AWS::SNS::Topic",
  )) {
    const p = props(resource);

    const topic: SNSTopicConfig = {};
    if (typeof p.TopicName === "string") {
      topic.topicName = p.TopicName;
    }
    if (typeof p.DisplayName === "string") {
      topic.displayName = p.DisplayName;
    }
    if (typeof p.FifoTopic === "boolean") {
      topic.fifoTopic = p.FifoTopic;
    }
    if (typeof p.ContentBasedDeduplication === "boolean") {
      topic.contentBasedDeduplication = p.ContentBasedDeduplication;
    }
    if (
      p.FifoThroughputScope === "Topic" ||
      p.FifoThroughputScope === "MessageGroup"
    ) {
      topic.fifoThroughputScope = p.FifoThroughputScope;
    }
    if (typeof p.KmsMasterKeyId === "string") {
      topic.kmsMasterKeyId = p.KmsMasterKeyId;
    }
    if (typeof p.SignatureVersion === "string") {
      topic.signatureVersion = p.SignatureVersion;
    }
    if (p.TracingConfig === "PassThrough" || p.TracingConfig === "Active") {
      topic.tracingConfig = p.TracingConfig;
    }

    const archivePolicy =
      p.ArchivePolicy && typeof p.ArchivePolicy === "object" && !Array.isArray(p.ArchivePolicy)
        ? (p.ArchivePolicy as Record<string, unknown>)
        : undefined;
    if (archivePolicy) {
      topic.archivePolicy = archivePolicy;
    }

    if (typeof p.DataProtectionPolicy === "string") {
      topic.dataProtectionPolicy = p.DataProtectionPolicy;
    } else if (
      p.DataProtectionPolicy &&
      typeof p.DataProtectionPolicy === "object" &&
      !Array.isArray(p.DataProtectionPolicy)
    ) {
      topic.dataProtectionPolicy = p.DataProtectionPolicy as Record<string, unknown>;
    }

    if (Array.isArray(p.DeliveryStatusLogging)) {
      const deliveryStatusLogging = p.DeliveryStatusLogging
        .filter(
          (entry): entry is Record<string, unknown> =>
            entry !== null && typeof entry === "object" && !Array.isArray(entry),
        )
        .filter(
          (entry) =>
            typeof entry.Protocol === "string" && entry.Protocol.length > 0,
        )
        .map((entry) => {
          const successFeedbackSampleRate = entry.SuccessFeedbackSampleRate;
          const mapped: NonNullable<SNSTopicConfig["deliveryStatusLogging"]>[number] = {
            protocol: entry.Protocol as string,
            failureFeedbackRoleArn:
              typeof entry.FailureFeedbackRoleArn === "string"
                ? entry.FailureFeedbackRoleArn
                : undefined,
            successFeedbackRoleArn:
              typeof entry.SuccessFeedbackRoleArn === "string"
                ? entry.SuccessFeedbackRoleArn
                : undefined,
            successFeedbackSampleRate:
              typeof successFeedbackSampleRate === "string"
                ? successFeedbackSampleRate
                : typeof successFeedbackSampleRate === "number"
                  ? String(successFeedbackSampleRate)
                  : undefined,
          };
          return mapped;
        });
      if (deliveryStatusLogging.length > 0) {
        topic.deliveryStatusLogging = deliveryStatusLogging;
      }
    }

    if (Array.isArray(p.Tags)) {
      const tags: Record<string, string> = {};
      for (const rawTag of p.Tags) {
        if (
          rawTag &&
          typeof rawTag === "object" &&
          !Array.isArray(rawTag) &&
          typeof (rawTag as { Key?: unknown }).Key === "string" &&
          typeof (rawTag as { Value?: unknown }).Value === "string"
        ) {
          tags[(rawTag as { Key: string }).Key] = (rawTag as { Value: string }).Value;
        }
      }
      if (Object.keys(tags).length > 0) {
        topic.tags = tags;
      }
    }

    const subs = snsSubscriptions
      .filter(
        (s) => s.topicLogicalId === logicalId,
      )
      .map((s) => s.subscription);
    if (subs.length > 0) {
      topic.subscriptions = subs;
    }

    topics[logicalId] = topic;
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
      functions[fnId].events.push(createSqsEvent(sourceId, batchSize));
    } else if (sourceType === "AWS::DynamoDB::Table") {
      const startingPosition = (p.StartingPosition as string) ?? undefined;
      functions[fnId].events.push(
        createDynamodbStreamEvent(sourceId, batchSize, startingPosition),
      );
    }
  }
}

function extractSNSSubscriptions(
  resources: Record<string, CfnResource>,
  resourceTypes: Map<string, string>,
): ExtractedSNSSubscription[] {
  const subscriptions: ExtractedSNSSubscription[] = [];

  const parseSubscriptionOptions = (
    properties: Record<string, unknown>,
  ): SNSSubscriptionOptionValues => {
    const options: SNSSubscriptionOptionValues = {};
    if (
      properties.DeliveryPolicy &&
      typeof properties.DeliveryPolicy === "object" &&
      !Array.isArray(properties.DeliveryPolicy)
    ) {
      options.deliveryPolicy = properties.DeliveryPolicy as Record<string, unknown>;
    }
    if (
      properties.FilterPolicy &&
      typeof properties.FilterPolicy === "object" &&
      !Array.isArray(properties.FilterPolicy)
    ) {
      options.filterPolicy = properties.FilterPolicy as Record<string, unknown>;
    }
    if (
      properties.FilterPolicyScope === "MessageAttributes" ||
      properties.FilterPolicyScope === "MessageBody"
    ) {
      options.filterPolicyScope = properties.FilterPolicyScope;
    }
    if (typeof properties.RawMessageDelivery === "boolean") {
      options.rawMessageDelivery = properties.RawMessageDelivery;
    }
    if (
      properties.RedrivePolicy &&
      typeof properties.RedrivePolicy === "object" &&
      !Array.isArray(properties.RedrivePolicy)
    ) {
      options.redrivePolicy = properties.RedrivePolicy as Record<string, unknown>;
    }
    if (typeof properties.Region === "string") {
      options.region = properties.Region;
    }
    if (typeof properties.ReplayPolicy === "string") {
      options.replayPolicy = properties.ReplayPolicy;
    } else if (
      properties.ReplayPolicy &&
      typeof properties.ReplayPolicy === "object" &&
      !Array.isArray(properties.ReplayPolicy)
    ) {
      options.replayPolicy = properties.ReplayPolicy as Record<string, unknown>;
    }
    if (typeof properties.SubscriptionRoleArn === "string") {
      options.subscriptionRoleArn = properties.SubscriptionRoleArn;
    }
    return options;
  };

  const parseSubscription = (
    topicLogicalId: string,
    protocolValue: unknown,
    endpointValue: unknown,
    options: SNSSubscriptionOptionValues,
  ): ExtractedSNSSubscription | undefined => {
    if (typeof protocolValue !== "string" || protocolValue.length === 0) {
      return undefined;
    }
    const protocol = protocolValue.toLowerCase();

    const endpointLogicalId = resolveLogicalId(endpointValue);
    if (endpointLogicalId) {
      const endpointType = resourceTypes.get(endpointLogicalId);
      if (protocol === "lambda" && endpointType === "AWS::Lambda::Function") {
        return {
          topicLogicalId,
          protocol,
          endpointLogicalId,
          subscription: {
            type: "lambda",
            target: endpointLogicalId,
            ...options,
          },
        };
      }
      if (protocol === "sqs" && endpointType === "AWS::SQS::Queue") {
        return {
          topicLogicalId,
          protocol,
          endpointLogicalId,
          subscription: {
            type: "sqs",
            target: endpointLogicalId,
            ...options,
          },
        };
      }
    }

    if (typeof endpointValue === "string") {
      return {
        topicLogicalId,
        protocol,
        subscription: {
          protocol,
          endpoint: endpointValue,
          ...options,
        },
      };
    }

    return undefined;
  };

  for (const [, resource] of getResourcesByType(
    resources,
    "AWS::SNS::Subscription",
  )) {
    const p = props(resource);
    const topicId = resolveLogicalId(p.TopicArn);
    if (!topicId) continue;

    const parsed = parseSubscription(
      topicId,
      p.Protocol,
      p.Endpoint,
      parseSubscriptionOptions(p),
    );
    if (parsed) {
      subscriptions.push(parsed);
    }
  }

  for (const [topicLogicalId, resource] of getResourcesByType(
    resources,
    "AWS::SNS::Topic",
  )) {
    const p = props(resource);
    if (!Array.isArray(p.Subscription)) continue;

    for (const inlineSub of p.Subscription) {
      if (
        inlineSub === null ||
        typeof inlineSub !== "object" ||
        Array.isArray(inlineSub)
      ) {
        continue;
      }
      const inline = inlineSub as Record<string, unknown>;
      const parsed = parseSubscription(
        topicLogicalId,
        inline.Protocol,
        inline.Endpoint,
        {},
      );
      if (parsed) {
        subscriptions.push(parsed);
      }
    }
  }

  return subscriptions;
}

function wireSNSLambdaSubscriptions(
  subscriptions: ExtractedSNSSubscription[],
  functions: Record<string, FunctionModel>,
): void {
  for (const sub of subscriptions) {
    if (
      sub.protocol === "lambda" &&
      sub.endpointLogicalId &&
      functions[sub.endpointLogicalId]
    ) {
      functions[sub.endpointLogicalId].events.push(
        createSnsEvent(sub.topicLogicalId),
      );
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

      functions[fnId].events.push(createS3Event(logicalId, [lambdaConfig.Event]));
    }
  }
}

function wireEventBridgeRules(
  resources: Record<string, CfnResource>,
  functions: Record<string, FunctionModel>,
): void {
  for (const [logicalId, resource] of getResourcesByType(
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

      functions[fnId].events.push(
        createEventBridgeEvent(
          {
            schedule:
              typeof p.ScheduleExpression === "string"
                ? p.ScheduleExpression
                : undefined,
            eventPattern:
              p.EventPattern &&
              typeof p.EventPattern === "object"
                ? (p.EventPattern as Record<string, unknown>)
                : undefined,
          },
          `CloudFormation EventBridge rule "${logicalId}" must define ScheduleExpression or EventPattern.`,
        ),
      );
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

    functions[fnId].events.push(createHttpEvent(method, path));
  }
}

function wireFunctionUrls(
  resources: Record<string, CfnResource>,
  functions: Record<string, FunctionModel>,
): void {
  for (const [logicalId, resource] of getResourcesByType(
    resources,
    "AWS::Lambda::Url",
  )) {
    const p = props(resource);
    const fnId = resolveLogicalId(p.TargetFunctionArn);

    if (!fnId || !functions[fnId]) {
      throw new Error(
        `CloudFormation Lambda URL "${logicalId}" must target a Lambda function resource in the same template via Ref/GetAtt.`,
      );
    }

    if (p.Qualifier !== undefined) {
      throw new Error(
        `CloudFormation Lambda URL "${logicalId}" uses Qualifier, which yamlcdk does not support yet.`,
      );
    }

    if (functions[fnId].url) {
      throw new Error(
        `Function "${fnId}" has multiple Lambda URLs, but yamlcdk supports only one direct function URL per function.`,
      );
    }

    const cors = p.Cors as Record<string, unknown> | undefined;
    functions[fnId].url = {
      authType: (p.AuthType as FunctionUrlConfig["authType"]) ?? "AWS_IAM",
      invokeMode:
          (p.InvokeMode as FunctionUrlConfig["invokeMode"]) ?? "BUFFERED",
      cors: cors
          ? {
            allowCredentials:
                typeof cors.AllowCredentials === "boolean"
                    ? cors.AllowCredentials
                    : undefined,
            allowHeaders: toStringArray(
                cors.AllowHeaders,
                `CloudFormation Lambda URL "${logicalId}" CORS AllowHeaders`,
            ),
            allowedMethods: toFunctionUrlMethods(
                cors.AllowMethods,
                `CloudFormation Lambda URL "${logicalId}" CORS AllowMethods`,
            ),
            allowOrigins: toStringArray(
                cors.AllowOrigins,
                `CloudFormation Lambda URL "${logicalId}" CORS AllowOrigins`,
            ),
            exposeHeaders: toStringArray(
                cors.ExposeHeaders,
                `CloudFormation Lambda URL "${logicalId}" CORS ExposeHeaders`,
            ),
            maxAge:
                typeof cors.MaxAge === "number" ? cors.MaxAge : undefined,
          }
          : undefined,
    };
  }
}

// ─── CloudFront extractors ───────────────────────────────────

function extractCachePolicies(
  resources: Record<string, CfnResource>,
): Record<string, CloudFrontCachePolicyConfig> {
  const policies: Record<string, CloudFrontCachePolicyConfig> = {};

  for (const [logicalId, resource] of getResourcesByType(
    resources,
    "AWS::CloudFront::CachePolicy",
  )) {
    const p = props(resource);
    const cfg = (p.CachePolicyConfig as Record<string, unknown> | undefined) ?? {};

    const headersRaw = cfg.ParametersInCacheKeyAndForwardedToOrigin as
      | Record<string, unknown>
      | undefined;
    const headersConfig = headersRaw
      ? (headersRaw.HeadersConfig as Record<string, unknown> | undefined)
      : undefined;
    const cookiesConfig = headersRaw
      ? (headersRaw.CookiesConfig as Record<string, unknown> | undefined)
      : undefined;
    const queryStringsConfig = headersRaw
      ? (headersRaw.QueryStringsConfig as Record<string, unknown> | undefined)
      : undefined;

    const toStringArray = (v: unknown): string[] | undefined =>
      Array.isArray(v) && v.every((x) => typeof x === "string")
        ? (v as string[])
        : undefined;

    policies[logicalId] = {
      comment: typeof cfg.Comment === "string" ? cfg.Comment : undefined,
      defaultTtl: typeof cfg.DefaultTTL === "number" ? cfg.DefaultTTL : undefined,
      minTtl: typeof cfg.MinTTL === "number" ? cfg.MinTTL : undefined,
      maxTtl: typeof cfg.MaxTTL === "number" ? cfg.MaxTTL : undefined,
      headersConfig: headersConfig
        ? {
            behavior: (headersConfig.HeaderBehavior as "none" | "whitelist") ?? "none",
            headers: toStringArray(
              (headersConfig.Headers as { Items?: unknown } | undefined)?.Items,
            ),
          }
        : undefined,
      cookiesConfig: cookiesConfig
        ? {
            behavior:
              (cookiesConfig.CookieBehavior as
                | "none"
                | "all"
                | "whitelist"
                | "allExcept") ?? "none",
            cookies: toStringArray(
              (cookiesConfig.Cookies as { Items?: unknown } | undefined)?.Items,
            ),
          }
        : undefined,
      queryStringsConfig: queryStringsConfig
        ? {
            behavior:
              (queryStringsConfig.QueryStringBehavior as
                | "none"
                | "all"
                | "whitelist"
                | "allExcept") ?? "none",
            queryStrings: toStringArray(
              (queryStringsConfig.QueryStrings as
                | { Items?: unknown }
                | undefined)?.Items,
            ),
          }
        : undefined,
      enableGzip:
        typeof headersRaw?.EnableAcceptEncodingGzip === "boolean"
          ? headersRaw.EnableAcceptEncodingGzip
          : undefined,
      enableBrotli:
        typeof headersRaw?.EnableAcceptEncodingBrotli === "boolean"
          ? headersRaw.EnableAcceptEncodingBrotli
          : undefined,
    };
  }

  return policies;
}

function extractOriginRequestPolicies(
  resources: Record<string, CfnResource>,
): Record<string, CloudFrontOriginRequestPolicyConfig> {
  const policies: Record<string, CloudFrontOriginRequestPolicyConfig> = {};

  for (const [logicalId, resource] of getResourcesByType(
    resources,
    "AWS::CloudFront::OriginRequestPolicy",
  )) {
    const p = props(resource);
    const cfg =
      (p.OriginRequestPolicyConfig as Record<string, unknown> | undefined) ?? {};

    const toStringArray = (v: unknown): string[] | undefined =>
      Array.isArray(v) && v.every((x) => typeof x === "string")
        ? (v as string[])
        : undefined;

    const headersConfig = cfg.HeadersConfig as
      | Record<string, unknown>
      | undefined;
    const cookiesConfig = cfg.CookiesConfig as
      | Record<string, unknown>
      | undefined;
    const queryStringsConfig = cfg.QueryStringsConfig as
      | Record<string, unknown>
      | undefined;

    policies[logicalId] = {
      comment: typeof cfg.Comment === "string" ? cfg.Comment : undefined,
      headersConfig: headersConfig
        ? {
            behavior:
              (headersConfig.HeaderBehavior as
                | "none"
                | "allViewer"
                | "whitelist"
                | "allViewerAndWhitelistCloudFront") ?? "none",
            headers: toStringArray(
              (headersConfig.Headers as { Items?: unknown } | undefined)?.Items,
            ),
          }
        : undefined,
      cookiesConfig: cookiesConfig
        ? {
            behavior:
              (cookiesConfig.CookieBehavior as
                | "none"
                | "all"
                | "whitelist"
                | "allExcept") ?? "none",
            cookies: toStringArray(
              (cookiesConfig.Cookies as { Items?: unknown } | undefined)?.Items,
            ),
          }
        : undefined,
      queryStringsConfig: queryStringsConfig
        ? {
            behavior:
              (queryStringsConfig.QueryStringBehavior as
                | "none"
                | "all"
                | "whitelist") ?? "none",
            queryStrings: toStringArray(
              (queryStringsConfig.QueryStrings as
                | { Items?: unknown }
                | undefined)?.Items,
            ),
          }
        : undefined,
    };
  }

  return policies;
}

function extractDistributions(
  resources: Record<string, CfnResource>,
  resourceTypes: Map<string, string>,
): Record<string, CloudFrontDistributionConfig> {
  const distributions: Record<string, CloudFrontDistributionConfig> = {};

  for (const [logicalId, resource] of getResourcesByType(
    resources,
    "AWS::CloudFront::Distribution",
  )) {
    const p = props(resource);
    const cfg =
      (p.DistributionConfig as Record<string, unknown> | undefined) ?? {};

    const rawOrigins = (cfg.Origins as Array<Record<string, unknown>>) ?? [];
    const origins: CloudFrontDistributionConfig["origins"] = rawOrigins.map(
      (o) => {
        const customOriginConfig = o.CustomOriginConfig as
          | Record<string, unknown>
          | undefined;
        const rawDomainName = o.DomainName;
        const domainName =
          typeof rawDomainName === "string"
            ? rawDomainName
            : rawDomainName && typeof rawDomainName === "object"
              ? (rawDomainName as Record<string, unknown>)
              : String(rawDomainName ?? "");
        return {
          id: String(o.Id ?? ""),
          domainName,
          httpPort:
            typeof customOriginConfig?.HTTPPort === "number"
              ? customOriginConfig.HTTPPort
              : undefined,
          httpsPort:
            typeof customOriginConfig?.HTTPSPort === "number"
              ? customOriginConfig.HTTPSPort
              : undefined,
          originProtocolPolicy: customOriginConfig?.OriginProtocolPolicy
            ? (String(customOriginConfig.OriginProtocolPolicy).toLowerCase() as
                | "http-only"
                | "https-only"
                | "match-viewer")
            : undefined,
        };
      },
    );

    const resolvePolicyId = (value: unknown): string | undefined => {
      if (value === undefined || value === null) return undefined;
      const logicalRef = resolveLogicalId(value);
      if (logicalRef) {
        const type = resourceTypes.get(logicalRef);
        if (
          type === "AWS::CloudFront::CachePolicy" ||
          type === "AWS::CloudFront::OriginRequestPolicy"
        ) {
          return logicalRef;
        }
      }
      if (typeof value === "string") return value;
      return undefined;
    };

    const adaptBehavior = (
      b: Record<string, unknown>,
    ): CloudFrontDistributionConfig["defaultBehavior"] => {
      const rawMethods = (b.AllowedMethods as string[] | undefined) ?? [];
      return {
        targetOriginId: String(b.TargetOriginId ?? ""),
        viewerProtocolPolicy: (
          String(b.ViewerProtocolPolicy ?? "redirect-to-https")
            .toLowerCase()
            .replace(/-/g, "-") as
            | "https-only"
            | "redirect-to-https"
            | "allow-all"
        ),
        cachePolicyId: resolvePolicyId(b.CachePolicyId),
        originRequestPolicyId: resolvePolicyId(b.OriginRequestPolicyId),
        allowedMethods: rawMethods.length > 0 ? rawMethods : undefined,
        compress:
          typeof b.Compress === "boolean" ? b.Compress : undefined,
      };
    };

    const rawDefaultBehavior =
      (cfg.DefaultCacheBehavior as Record<string, unknown> | undefined) ?? {};
    const rawAdditionalBehaviors =
      (cfg.CacheBehaviors as Array<Record<string, unknown>>) ?? [];

    const viewerCertificate = cfg.ViewerCertificate as
      | Record<string, unknown>
      | undefined;
    const certificateArn =
      typeof viewerCertificate?.AcmCertificateArn === "string"
        ? viewerCertificate.AcmCertificateArn
        : undefined;

    const rawDomainNames = (cfg.Aliases as string[] | undefined) ?? [];

    distributions[logicalId] = {
      comment:
        typeof cfg.Comment === "string" ? cfg.Comment : undefined,
      enabled:
        typeof cfg.Enabled === "boolean" ? cfg.Enabled : undefined,
      priceClass: cfg.PriceClass
        ? (String(cfg.PriceClass) as
            | "PriceClass_All"
            | "PriceClass_200"
            | "PriceClass_100")
        : undefined,
      httpVersion: cfg.HttpVersion
        ? (String(cfg.HttpVersion) as
            | "http1.1"
            | "http2"
            | "http2and3"
            | "http3")
        : undefined,
      origins,
      defaultBehavior: adaptBehavior(rawDefaultBehavior),
      additionalBehaviors:
        rawAdditionalBehaviors.length > 0
          ? rawAdditionalBehaviors.map((b) => ({
              ...adaptBehavior(b),
              pathPattern: String(b.PathPattern ?? ""),
            }))
          : undefined,
      domainNames: rawDomainNames.length > 0 ? rawDomainNames : undefined,
      certificateArn,
      webAclId:
        typeof cfg.WebACLId === "string" ? cfg.WebACLId : undefined,
    };
  }

  return distributions;
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
  const cachePolicies = extractCachePolicies(allResources);
  const originRequestPolicies = extractOriginRequestPolicies(allResources);
  const distributions = extractDistributions(allResources, resourceTypes);

  // Wire events to functions
  wireEventSourceMappings(allResources, functions, resourceTypes);
  wireSNSLambdaSubscriptions(snsSubscriptions, functions);
  wireS3Notifications(allResources, functions);
  wireEventBridgeRules(allResources, functions);
  wireHttpApiRoutes(allResources, functions);
  wireFunctionUrls(allResources, functions);

  const domainInput: CloudFormationDomainConfigInput = {
    s3: {
      buckets,
      cleanupRoleArn: meta.s3?.cleanupRoleArn,
    },
    dynamodb: { tables },
    sqs: { queues },
    sns: { topics },
    apis: {
      restApi: meta.restApi?.cloudWatchRoleArn
        ? { cloudWatchRoleArn: meta.restApi.cloudWatchRoleArn }
        : undefined,
    },
    cloudfront: {
      cachePolicies,
      originRequestPolicies,
      distributions,
    },
  };

  const passthroughOutputs =
    template.Outputs && Object.keys(template.Outputs).length > 0
      ? (template.Outputs as Record<string, Record<string, unknown>>)
      : undefined;

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
    domainConfigs: adaptDomainConfigsFromCloudFormation(domainInput),
    passthroughOutputs,
  });
}
