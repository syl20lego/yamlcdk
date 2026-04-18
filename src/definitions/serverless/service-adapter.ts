import fs from "node:fs";
import path from "node:path";
import type {
  EventDeclaration,
  FunctionModel,
  FunctionUrlConfig,
  ProviderConfig,
  ServiceModel,
} from "../../compiler/model.js";
import { parseServiceModel } from "../../compiler/model.js";
import { DomainConfigs } from "../../compiler/plugins/index.js";
import { adaptCfnTemplate } from "../cloudformation/index.js";
import { parseCfnYaml, resolveLogicalId } from "../cloudformation/cfn-yaml.js";
import {
  appendUniqueEvent,
  createDynamodbStreamEvent,
  createEventBridgeEvent,
  createHttpEvent,
  createRestEvent,
  createS3Event,
  createSnsEvent,
  createSqsEvent,
} from "../shared-event-adapters.js";
import { resolveDefinitionVariables } from "../variables/resolve.js";
import { isCfnIntrinsicEnv, type EnvValue } from "../../schema/cfn-env.js";
import {
  type ServerlessDomainState as DomainState,
  createEmptyServerlessDomainState,
} from "../domain-adapter-types.js";
import {
  readServerlessDomainStateFromConfigs,
  writeServerlessDomainStateToConfigs,
} from "./domain-adapters.js";

interface CfnResource {
  Type: string;
  Properties?: Record<string, unknown>;
}

interface ServerlessProviderConfig {
  name?: unknown;
  stage?: unknown;
  region?: unknown;
  runtime?: unknown;
  timeout?: unknown;
  memorySize?: unknown;
  stackName?: unknown;
  profile?: unknown;
  tags?: unknown;
  account?: unknown;
  iam?: unknown;
  deployment?: unknown;
  deploymentBucket?: unknown;
}

interface TopLevelAdaptation {
  service: string;
  provider: ProviderConfig;
  stackName: string;
  functions: Record<string, FunctionModel>;
  domainConfigs: DomainConfigs;
  functionLogicalIds: Map<string, string>;
}

const SERVERLESS_URL_CORS_ALLOW_ALL_HEADERS = [
  "Content-Type",
  "X-Amz-Date",
  "Authorization",
  "X-Api-Key",
  "X-Amz-Security-Token",
];

function sanitizeName(input: string): string {
  return input.replace(/[^a-zA-Z0-9-]/g, "-").toLowerCase();
}

function toServerlessLogicalIdSegment(value: string): string {
  return value
    .replace(/([a-z0-9])([A-Z])/g, "$1 $2")
    .split(/[^A-Za-z0-9]+/)
    .filter(Boolean)
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
    .join("");
}

export function toServerlessFunctionLogicalId(functionName: string): string {
  return `${toServerlessLogicalIdSegment(functionName)}LambdaFunction`;
}


interface ResolveServerlessVariablesOptions {
  filePath?: string;
  opt?: Record<string, unknown>;
  stage?: string;
}

export function resolveServerlessVariables(
  input: unknown,
  options: ResolveServerlessVariablesOptions = {},
): unknown {
  return resolveDefinitionVariables(input, {
    entryFilePath: options.filePath,
    parseContent: (content) => parseCfnYaml(content),
    opt: options.opt,
    stage: options.stage ?? (options.opt?.stage as string | undefined),
  });
}

function requireString(value: unknown, description: string): string {
  if (typeof value !== "string" || value.length === 0) {
    throw new Error(`${description} must be a non-empty string.`);
  }
  return value;
}

function optionalString(value: unknown, description: string): string | undefined {
  if (value === undefined) return undefined;
  return requireString(value, description);
}

function optionalNumber(value: unknown, description: string): number | undefined {
  if (value === undefined) return undefined;
  if (typeof value !== "number" || !Number.isFinite(value)) {
    throw new Error(`${description} must be a number.`);
  }
  return value;
}

function optionalBoolean(value: unknown, description: string): boolean | undefined {
  if (value === undefined) return undefined;
  if (typeof value !== "boolean") {
    throw new Error(`${description} must be a boolean.`);
  }
  return value;
}

function optionalStringRecord(
  value: unknown,
  description: string,
): Record<string, string> | undefined {
  if (value === undefined) return undefined;
  if (value === null || typeof value !== "object" || Array.isArray(value)) {
    throw new Error(`${description} must be an object.`);
  }

  const result: Record<string, string> = {};
  for (const [key, entry] of Object.entries(value as Record<string, unknown>)) {
    if (
      typeof entry !== "string" &&
      typeof entry !== "number" &&
      typeof entry !== "boolean"
    ) {
      throw new Error(`${description}.${key} must resolve to a scalar value.`);
    }
    result[key] = String(entry);
  }
  return result;
}

function optionalEnvRecord(
  value: unknown,
  description: string,
): Record<string, EnvValue> | undefined {
  if (value === undefined) return undefined;
  if (value === null || typeof value !== "object" || Array.isArray(value)) {
    throw new Error(`${description} must be an object.`);
  }

  const result: Record<string, EnvValue> = {};
  for (const [key, entry] of Object.entries(value as Record<string, unknown>)) {
    if (
      typeof entry === "string" ||
      typeof entry === "number" ||
      typeof entry === "boolean"
    ) {
      result[key] = String(entry);
    } else if (entry !== null && typeof entry === "object" && isCfnIntrinsicEnv(entry)) {
      result[key] = entry;
    } else {
      throw new Error(
        `${description}.${key} must be a scalar value or a supported CloudFormation intrinsic (Ref, Fn::GetAtt, Fn::Sub, Fn::Join).`,
      );
    }
  }
  return result;
}

function optionalObject(
  value: unknown,
  description: string,
): Record<string, unknown> | undefined {
  if (value === undefined) return undefined;
  if (value === null || typeof value !== "object" || Array.isArray(value)) {
    throw new Error(`${description} must be an object.`);
  }
  return value as Record<string, unknown>;
}

function inferBuildMode(handler: string): FunctionModel["build"] {
  const [modulePath] = handler.split(".");
  const absTs = path.resolve(process.cwd(), `${modulePath}.ts`);
  return { mode: fs.existsSync(absTs) ? "typescript" : "none" };
}

function mergeFunctionUrl(
  functionName: string,
  primary: FunctionUrlConfig | undefined,
  incoming: FunctionUrlConfig | undefined,
): FunctionUrlConfig | undefined {
  if (!primary) return incoming;
  if (!incoming) return primary;
  if (JSON.stringify(primary) !== JSON.stringify(incoming)) {
    throw new Error(
      `Function "${functionName}" defines conflicting Lambda Function URL settings between top-level Serverless config and resources.Resources.`,
    );
  }
  return primary;
}

function mergeFlatConfig<T extends Record<string, unknown>>(
  label: string,
  name: string,
  primary: T | undefined,
  incoming: T | undefined,
): T | undefined {
  if (!primary) return incoming;
  if (!incoming) return primary;

  const merged: Record<string, unknown> = { ...primary };
  for (const [key, value] of Object.entries(incoming)) {
    const existing = merged[key];
    if (existing !== undefined && value !== undefined) {
      if (JSON.stringify(existing) !== JSON.stringify(value)) {
        throw new Error(
          `${label} "${name}" has conflicting "${key}" settings between top-level Serverless config and resources.Resources.`,
        );
      }
      continue;
    }
    merged[key] = value;
  }
  return merged as T;
}

function mergeSnsTopicConfig(
  name: string,
  primary: DomainState["sns"][string] | undefined,
  incoming: DomainState["sns"][string] | undefined,
): DomainState["sns"][string] | undefined {
  const merged = mergeFlatConfig("SNS topic", name, primary, incoming);
  if (!merged) return undefined;

  const subscriptions = [
    ...(primary?.subscriptions ?? []),
    ...(incoming?.subscriptions ?? []),
  ];
  if (subscriptions.length === 0) return merged;

  const uniqueSubscriptions = subscriptions.filter(
    (subscription, index) =>
      subscriptions.findIndex(
        (candidate) =>
          JSON.stringify(candidate) === JSON.stringify(subscription),
      ) === index,
  );

  return { ...merged, subscriptions: uniqueSubscriptions };
}

function remapSnsLambdaSubscriptionTargets(
  topics: DomainState["sns"],
  logicalIdToName: Map<string, string>,
): DomainState["sns"] {
  return Object.fromEntries(
    Object.entries(topics).map(([topicName, topicConfig]) => {
      const subscriptions = topicConfig.subscriptions?.map((subscription) => {
        if ("type" in subscription && subscription.type === "lambda") {
          const mappedTarget = logicalIdToName.get(subscription.target);
          if (mappedTarget) {
            return { ...subscription, target: mappedTarget };
          }
        }
        return subscription;
      });

      if (!subscriptions) {
        return [topicName, topicConfig];
      }
      return [topicName, { ...topicConfig, subscriptions }];
    }),
  );
}

function resolveServerlessReferenceName(
  value: unknown,
  description: string,
): string | undefined {
  if (typeof value === "string" && value.length > 0 && !value.startsWith("arn:")) {
    return value;
  }

  const logicalId = resolveLogicalId(value);
  if (logicalId) return logicalId;

  if (typeof value === "string") {
    throw new Error(
      `${description} must reference a managed resource. External ARN strings are not supported yet by yamlcdk's current domain model.`,
    );
  }

  return undefined;
}

function adaptFunctionUrl(value: unknown, description: string): FunctionUrlConfig | undefined {
  if (value === undefined || value === false) return undefined;
  if (value === true) {
    return {
      authType: "NONE",
      invokeMode: "BUFFERED",
    };
  }
  if (value === null || typeof value !== "object" || Array.isArray(value)) {
    throw new Error(`${description} must be true or an object.`);
  }

  const config = value as Record<string, unknown>;
  const authorizer = optionalString(config.authorizer, `${description}.authorizer`);
  if (authorizer && authorizer !== "aws_iam") {
    throw new Error(
      `${description}.authorizer only supports "aws_iam" with yamlcdk's current domain model.`,
    );
  }

  let cors: FunctionUrlConfig["cors"];
  if (config.cors === true) {
    cors = {
      allowHeaders: SERVERLESS_URL_CORS_ALLOW_ALL_HEADERS,
      allowedMethods: ["*"],
      allowOrigins: ["*"],
    };
  } else if (config.cors !== undefined) {
    if (
      config.cors === null ||
      typeof config.cors !== "object" ||
      Array.isArray(config.cors)
    ) {
      throw new Error(`${description}.cors must be true or an object.`);
    }
    const corsConfig = config.cors as Record<string, unknown>;
    cors = {
      allowCredentials:
        typeof corsConfig.allowCredentials === "boolean"
          ? corsConfig.allowCredentials
          : undefined,
      allowHeaders: Array.isArray(corsConfig.allowedHeaders)
        ? corsConfig.allowedHeaders.map((entry) =>
            requireString(entry, `${description}.cors.allowedHeaders[]`),
          )
        : undefined,
      allowedMethods: Array.isArray(corsConfig.allowedMethods)
        ? (corsConfig.allowedMethods.map((entry) =>
            requireString(entry, `${description}.cors.allowedMethods[]`),
          ) as NonNullable<FunctionUrlConfig["cors"]>["allowedMethods"])
        : undefined,
      allowOrigins: Array.isArray(corsConfig.allowedOrigins)
        ? corsConfig.allowedOrigins.map((entry) =>
            requireString(entry, `${description}.cors.allowedOrigins[]`),
          )
        : undefined,
      exposeHeaders: Array.isArray(corsConfig.exposedResponseHeaders)
        ? corsConfig.exposedResponseHeaders.map((entry) =>
            requireString(entry, `${description}.cors.exposedResponseHeaders[]`),
          )
        : undefined,
      maxAge: optionalNumber(corsConfig.maxAge, `${description}.cors.maxAge`) as
        | number
        | undefined,
    };
  }

  const invokeMode = optionalString(config.invokeMode, `${description}.invokeMode`);
  if (invokeMode && invokeMode !== "BUFFERED" && invokeMode !== "RESPONSE_STREAM") {
    throw new Error(
      `${description}.invokeMode must be BUFFERED or RESPONSE_STREAM.`,
    );
  }

  return {
    authType: authorizer === "aws_iam" ? "AWS_IAM" : "NONE",
    cors,
    invokeMode:
      (invokeMode as FunctionUrlConfig["invokeMode"] | undefined) ?? "BUFFERED",
  };
}

function adaptHttpEvent(value: unknown, description: string): EventDeclaration {
  if (typeof value === "string") {
    const parts = value.trim().split(/\s+/);
    if (parts.length !== 2) {
      throw new Error(`${description} must look like "METHOD /path".`);
    }
    return createRestEvent(parts[0], parts[1], false);
  }

  if (value === null || typeof value !== "object" || Array.isArray(value)) {
    throw new Error(`${description} must be a string or object.`);
  }

  const config = value as Record<string, unknown>;
  if (
    config.integration !== undefined &&
    config.integration !== "lambda-proxy" &&
    config.integration !== "aws-proxy" &&
    config.integration !== "aws_proxy"
  ) {
    throw new Error(
      `${description}.integration is not supported by yamlcdk's current REST API model.`,
    );
  }

  return createRestEvent(
    requireString(config.method, `${description}.method`),
    requireString(config.path, `${description}.path`),
    typeof config.private === "boolean" ? config.private : false,
  );
}

function adaptHttpApiEvent(value: unknown, description: string): EventDeclaration {
  if (value === "*") {
    throw new Error(
      `${description} catch-all routes are not supported by yamlcdk's current HTTP API model.`,
    );
  }

  if (typeof value === "string") {
    const parts = value.trim().split(/\s+/);
    if (parts.length !== 2) {
      throw new Error(`${description} must look like "METHOD /path".`);
    }
    if (parts[0] === "*") {
      throw new Error(
        `${description} catch-all routes are not supported by yamlcdk's current HTTP API model.`,
      );
    }
    return createHttpEvent(parts[0], parts[1]);
  }

  if (value === null || typeof value !== "object" || Array.isArray(value)) {
    throw new Error(`${description} must be a string or object.`);
  }

  const config = value as Record<string, unknown>;
  const method = requireString(config.method, `${description}.method`).toUpperCase();
  if (method === "*") {
    throw new Error(
      `${description}.method="*" is not supported by yamlcdk's current HTTP API model.`,
    );
  }

  return createHttpEvent(
    method,
    requireString(config.path, `${description}.path`),
  );
}

function adaptScheduleEvent(value: unknown, description: string): EventDeclaration {
  if (typeof value === "string") {
    return createEventBridgeEvent({ schedule: value });
  }

  if (value === null || typeof value !== "object" || Array.isArray(value)) {
    throw new Error(`${description} must be a string or object.`);
  }

  const config = value as Record<string, unknown>;
  if (config.enabled === false) {
    throw new Error(`${description}.enabled=false is not supported yet.`);
  }
  if (config.input !== undefined || config.inputPath !== undefined) {
    throw new Error(
      `${description} only supports the schedule expression with yamlcdk's current EventBridge model.`,
    );
  }

  const rate = config.rate;
  if (typeof rate === "string") {
    return createEventBridgeEvent({ schedule: rate });
  }
  if (Array.isArray(rate) && rate.length > 0 && typeof rate[0] === "string") {
    return createEventBridgeEvent({ schedule: rate[0] });
  }

  throw new Error(`${description}.rate must be a string or non-empty array.`);
}

function adaptS3Event(
  value: unknown,
  description: string,
  domains: DomainState,
): EventDeclaration {
  if (typeof value === "string") {
    domains.s3[value] ??= {};
    return createS3Event(value, ["s3:ObjectCreated:*"]);
  }

  if (value === null || typeof value !== "object" || Array.isArray(value)) {
    throw new Error(`${description} must be a string or object.`);
  }

  const config = value as Record<string, unknown>;
  if (config.existing === true || config.forceDeploy === true || config.rules !== undefined) {
    throw new Error(
      `${description} only supports basic bucket/event wiring with yamlcdk's current S3 model.`,
    );
  }

  const bucket = resolveServerlessReferenceName(config.bucket, `${description}.bucket`);
  if (!bucket) {
    throw new Error(`${description}.bucket must be a bucket name or Ref/GetAtt.`);
  }

  domains.s3[bucket] ??= {};
  return createS3Event(bucket, [
    optionalString(config.event, `${description}.event`) ?? "s3:ObjectCreated:*",
  ]);
}

function adaptSnsEvent(
  value: unknown,
  description: string,
  domains: DomainState,
): EventDeclaration {
  if (typeof value === "string") {
    if (value.startsWith("arn:")) {
      throw new Error(
        `${description} cannot target an external SNS ARN with yamlcdk's current domain model.`,
      );
    }
    domains.sns[value] ??= {};
    return createSnsEvent(value);
  }

  if (value === null || typeof value !== "object" || Array.isArray(value)) {
    throw new Error(`${description} must be a string or object.`);
  }

  const config = value as Record<string, unknown>;
  if (
    config.filterPolicy !== undefined ||
    config.filterPolicyScope !== undefined ||
    config.redrivePolicy !== undefined ||
    config.kmsMasterKeyId !== undefined ||
    config.displayName !== undefined
  ) {
    throw new Error(
      `${description} only supports basic topic subscriptions with yamlcdk's current SNS model.`,
    );
  }

  const topicName = optionalString(config.topicName, `${description}.topicName`);
  const arnRef = resolveLogicalId(config.arn);
  if (arnRef) {
    domains.sns[arnRef] ??= {};
    return createSnsEvent(arnRef);
  }

  if (typeof config.arn === "string") {
    throw new Error(
      `${description}.arn cannot target an external SNS ARN with yamlcdk's current domain model.`,
    );
  }

  if (!topicName) {
    throw new Error(
      `${description} must use a topic name or a Ref/GetAtt-backed arn.`,
    );
  }

  domains.sns[topicName] ??= {};
  return createSnsEvent(topicName);
}

function adaptSqsEvent(
  value: unknown,
  description: string,
  domains: DomainState,
): EventDeclaration {
  if (typeof value === "string") {
    throw new Error(
      `${description} must reference an internal SQS queue via Ref/GetAtt for yamlcdk's current domain model.`,
    );
  }
  if (value === null || typeof value !== "object" || Array.isArray(value)) {
    throw new Error(`${description} must be an object.`);
  }

  const config = value as Record<string, unknown>;
  if (config.enabled === false) {
    throw new Error(`${description}.enabled=false is not supported yet.`);
  }

  const queue = resolveLogicalId(config.arn);
  if (!queue) {
    throw new Error(
      `${description}.arn must reference an internal SQS queue via Ref/GetAtt for yamlcdk's current domain model.`,
    );
  }

  domains.sqs[queue] ??= {};
  return createSqsEvent(
    queue,
    optionalNumber(config.batchSize, `${description}.batchSize`) as
      | number
      | undefined,
  );
}

function adaptStreamEvent(value: unknown, description: string): EventDeclaration {
  if (typeof value === "string") {
    throw new Error(
      `${description} must specify a DynamoDB stream object for yamlcdk's current domain model.`,
    );
  }
  if (value === null || typeof value !== "object" || Array.isArray(value)) {
    throw new Error(`${description} must be an object.`);
  }

  const config = value as Record<string, unknown>;
  const type = optionalString(config.type, `${description}.type`);
  if (type !== "dynamodb") {
    throw new Error(
      `${description} only supports DynamoDB streams with yamlcdk's current domain model.`,
    );
  }

  const table = resolveLogicalId(config.arn);
  if (!table) {
    throw new Error(
      `${description}.arn must reference an internal DynamoDB table stream via Ref/GetAtt.`,
    );
  }

  return createDynamodbStreamEvent(
    table,
    optionalNumber(config.batchSize, `${description}.batchSize`) as
      | number
      | undefined,
    optionalString(config.startingPosition, `${description}.startingPosition`),
  );
}

function adaptEventBridgeEvent(
  value: unknown,
  description: string,
): EventDeclaration {
  if (value === null || typeof value !== "object" || Array.isArray(value)) {
    throw new Error(`${description} must be an object.`);
  }

  const config = value as Record<string, unknown>;
  if (config.enabled === false) {
    throw new Error(`${description}.enabled=false is not supported yet.`);
  }
  if (
    config.eventBus !== undefined &&
    config.eventBus !== "default"
  ) {
    throw new Error(
      `${description}.eventBus is not supported by yamlcdk's current EventBridge model.`,
    );
  }
  if (
    config.input !== undefined ||
    config.inputPath !== undefined ||
    config.inputTransformer !== undefined ||
    config.deadLetterQueueArn !== undefined ||
    config.retryPolicy !== undefined
  ) {
    throw new Error(
      `${description} only supports schedule and pattern with yamlcdk's current EventBridge model.`,
    );
  }

  const schedule = optionalString(config.schedule, `${description}.schedule`);
  const pattern =
    config.pattern && typeof config.pattern === "object" && !Array.isArray(config.pattern)
      ? (config.pattern as Record<string, unknown>)
      : undefined;

  if (!schedule && !pattern) {
    throw new Error(`${description} must define schedule or pattern.`);
  }

  return createEventBridgeEvent(
    { schedule, eventPattern: pattern },
    `${description} must define schedule or pattern.`,
  );
}

function adaptEvents(
  functionName: string,
  value: unknown,
  domains: DomainState,
): EventDeclaration[] {
  if (value === undefined) return [];
  if (!Array.isArray(value)) {
    throw new Error(`functions.${functionName}.events must be an array.`);
  }

  const events: EventDeclaration[] = [];

  for (const [index, rawEvent] of value.entries()) {
    if (rawEvent === null || typeof rawEvent !== "object" || Array.isArray(rawEvent)) {
      throw new Error(`functions.${functionName}.events[${index}] must be an object.`);
    }

    const entries = Object.entries(rawEvent as Record<string, unknown>);
    if (entries.length !== 1) {
      throw new Error(
        `functions.${functionName}.events[${index}] must contain exactly one event type.`,
      );
    }

    const [eventType, eventValue] = entries[0];
    const description = `functions.${functionName}.events[${index}].${eventType}`;

    switch (eventType) {
      case "http":
        appendUniqueEvent(events, adaptHttpEvent(eventValue, description));
        break;
      case "httpApi":
        appendUniqueEvent(events, adaptHttpApiEvent(eventValue, description));
        break;
      case "schedule":
        appendUniqueEvent(events, adaptScheduleEvent(eventValue, description));
        break;
      case "s3":
        appendUniqueEvent(events, adaptS3Event(eventValue, description, domains));
        break;
      case "sns":
        appendUniqueEvent(events, adaptSnsEvent(eventValue, description, domains));
        break;
      case "sqs":
        appendUniqueEvent(events, adaptSqsEvent(eventValue, description, domains));
        break;
      case "stream":
        appendUniqueEvent(events, adaptStreamEvent(eventValue, description));
        break;
      case "eventBridge":
        appendUniqueEvent(events, adaptEventBridgeEvent(eventValue, description));
        break;
      default:
        throw new Error(
          `functions.${functionName}.events[${index}] uses unsupported Serverless event "${eventType}" for yamlcdk's current domain model.`,
        );
    }
  }

  return events;
}

function createFunctionPlaceholderResources(
  functions: Record<string, FunctionModel>,
  logicalIds: Map<string, string>,
): Record<string, CfnResource> {
  return Object.fromEntries(
    Object.entries(functions).map(([name, fn]) => {
      const logicalId = logicalIds.get(name) ?? toServerlessFunctionLogicalId(name);
      return [
        logicalId,
        {
          Type: "AWS::Lambda::Function",
          Properties: {
            Handler: fn.handler,
            Runtime: fn.runtime,
            Timeout: fn.timeout,
            MemorySize: fn.memorySize,
            Environment: fn.environment
              ? { Variables: fn.environment }
              : undefined,
          },
        } satisfies CfnResource,
      ];
    }),
  );
}

function assertNoGeneratedResourceConflicts(
  resources: Record<string, unknown>,
  functionLogicalIds: Map<string, string>,
): void {
  for (const logicalId of functionLogicalIds.values()) {
    if (logicalId in resources) {
      throw new Error(
        `resources.Resources.${logicalId} conflicts with a Serverless-generated function logical ID. Top-level functions are primary; custom resources may augment them but not override them.`,
      );
    }
  }
}

function adaptTopLevelServerlessConfig(
  resolved: Record<string, unknown>,
): TopLevelAdaptation {
  const rawService = resolved.service;
  const service =
    typeof rawService === "string"
      ? rawService
      : rawService &&
          typeof rawService === "object" &&
          typeof (rawService as Record<string, unknown>).name === "string"
        ? ((rawService as Record<string, unknown>).name as string)
        : undefined;

  if (!service) {
    throw new Error(`Serverless config must define "service".`);
  }

  const rawProvider =
    typeof resolved.provider === "string"
      ? ({ name: resolved.provider } satisfies ServerlessProviderConfig)
      : ((resolved.provider as ServerlessProviderConfig | undefined) ?? {});

  const providerName = rawProvider.name ?? "aws";
  if (providerName !== "aws") {
    throw new Error(`Only provider.name=aws is supported for serverless.yml.`);
  }

  const stage =
    optionalString(rawProvider.stage, "provider.stage") ?? "dev";
  const region =
    optionalString(rawProvider.region, "provider.region") ??
    process.env.AWS_REGION ??
    "us-east-1";

  const provider: ProviderConfig = {
    stage,
    region,
    account: optionalString(rawProvider.account, "provider.account"),
    profile: optionalString(rawProvider.profile, "provider.profile"),
    tags: optionalStringRecord(rawProvider.tags, "provider.tags"),
    deployment: undefined,
  };

  const providerIam = optionalObject(rawProvider.iam, "provider.iam");
  const providerDeployment = optionalObject(
    rawProvider.deployment,
    "provider.deployment",
  );
  const deploymentBucket = optionalObject(
    rawProvider.deploymentBucket,
    "provider.deploymentBucket",
  );
  const cloudFormationExecutionRoleArn = optionalString(
    providerIam?.deploymentRole,
    "provider.iam.deploymentRole",
  );
  const fileAssetsBucketName = optionalString(
    deploymentBucket?.name,
    "provider.deploymentBucket.name",
  );
  const requireBootstrap = optionalBoolean(
    providerDeployment?.requireBootstrap,
    "provider.deployment.requireBootstrap",
  );

  const deployment: NonNullable<ProviderConfig["deployment"]> = {};
  if (cloudFormationExecutionRoleArn) {
    deployment.cloudFormationExecutionRoleArn = cloudFormationExecutionRoleArn;
  }
  if (fileAssetsBucketName) {
    deployment.fileAssetsBucketName = fileAssetsBucketName;
  }
  if (requireBootstrap !== undefined) {
    deployment.requireBootstrap = requireBootstrap;
  }
  if (Object.keys(deployment).length > 0) {
    provider.deployment = deployment;
  }

  const stackName =
    optionalString(rawProvider.stackName, "provider.stackName") ??
    `${sanitizeName(service)}-${sanitizeName(stage)}`;

  const domains = createEmptyServerlessDomainState();
  const functions: Record<string, FunctionModel> = {};
  const functionLogicalIds = new Map<string, string>();
  const rawFunctions = resolved.functions;

  if (rawFunctions !== undefined) {
    if (rawFunctions === null || typeof rawFunctions !== "object" || Array.isArray(rawFunctions)) {
      throw new Error(`functions must be an object.`);
    }

    for (const [name, rawFunction] of Object.entries(
      rawFunctions as Record<string, unknown>,
    )) {
      if (
        rawFunction === null ||
        typeof rawFunction !== "object" ||
        Array.isArray(rawFunction)
      ) {
        throw new Error(`functions.${name} must be an object.`);
      }

      const fn = rawFunction as Record<string, unknown>;
      const handler = requireString(fn.handler, `functions.${name}.handler`);
      const runtime =
        optionalString(fn.runtime, `functions.${name}.runtime`) ??
        optionalString(rawProvider.runtime, "provider.runtime");
      const timeout =
        optionalNumber(fn.timeout, `functions.${name}.timeout`) ??
        optionalNumber(rawProvider.timeout, "provider.timeout");
      const memorySize =
        optionalNumber(fn.memorySize, `functions.${name}.memorySize`) ??
        optionalNumber(rawProvider.memorySize, "provider.memorySize");

      const roleArn = optionalString(fn.role, `functions.${name}.role`);
      functions[name] = {
        handler,
        runtime,
        timeout: timeout as number | undefined,
        memorySize: memorySize as number | undefined,
        environment: optionalEnvRecord(
          fn.environment,
          `functions.${name}.environment`,
        ),
        iam: roleArn ? [roleArn] : undefined,
        url: adaptFunctionUrl(fn.url, `functions.${name}.url`),
        build: inferBuildMode(handler),
        events: adaptEvents(name, fn.events, domains),
      };
      functionLogicalIds.set(name, toServerlessFunctionLogicalId(name));
    }
  }

  const domainConfigs = new DomainConfigs();
  writeServerlessDomainStateToConfigs(domainConfigs, domains);

  return {
    service,
    provider,
    stackName,
    functions,
    domainConfigs,
    functionLogicalIds,
  };
}

function adaptServerlessResources(
  resolved: Record<string, unknown>,
  topLevel: TopLevelAdaptation,
  filePath: string,
): ServiceModel | undefined {
  const rawResourcesContainer = resolved.resources;
  if (
    rawResourcesContainer === undefined ||
    rawResourcesContainer === null ||
    typeof rawResourcesContainer !== "object" ||
    Array.isArray(rawResourcesContainer)
  ) {
    return undefined;
  }

  const resourcesContainer = rawResourcesContainer as Record<string, unknown>;
  const rawResources =
    resourcesContainer.Resources &&
    typeof resourcesContainer.Resources === "object" &&
    !Array.isArray(resourcesContainer.Resources)
      ? (resourcesContainer.Resources as Record<string, unknown>)
      : {};
  const outputs =
    resourcesContainer.Outputs &&
    typeof resourcesContainer.Outputs === "object" &&
    !Array.isArray(resourcesContainer.Outputs)
      ? (resourcesContainer.Outputs as Record<string, unknown>)
      : undefined;

  if (Object.keys(rawResources).length === 0 && !outputs) {
    return undefined;
  }

  assertNoGeneratedResourceConflicts(rawResources, topLevel.functionLogicalIds);

  const template = {
    Metadata: {
      yamlcdk: {
        service: topLevel.service,
        stage: topLevel.provider.stage,
        region: topLevel.provider.region,
        account: topLevel.provider.account,
        profile: topLevel.provider.profile,
        tags: topLevel.provider.tags,
      },
    },
    Resources: {
      ...createFunctionPlaceholderResources(
        topLevel.functions,
        topLevel.functionLogicalIds,
      ),
      ...(rawResources as Record<string, CfnResource>),
    },
    Outputs: outputs,
  };

  return adaptCfnTemplate(template, filePath);
}

function mergeFunctions(
  topLevel: TopLevelAdaptation,
  resourceModel: ServiceModel | undefined,
): Record<string, FunctionModel> {
  if (!resourceModel) return topLevel.functions;

  const logicalIdToName = new Map(
    [...topLevel.functionLogicalIds.entries()].map(([name, logicalId]) => [
      logicalId,
      name,
    ]),
  );

  const merged: Record<string, FunctionModel> = { ...topLevel.functions };

  for (const [name, resourceFunction] of Object.entries(resourceModel.functions)) {
    const topLevelName = logicalIdToName.get(name);
    if (!topLevelName) {
      merged[name] = resourceFunction;
      continue;
    }

    const topLevelFunction = merged[topLevelName];
    const events = [...topLevelFunction.events];
    for (const event of resourceFunction.events) {
      appendUniqueEvent(events, event);
    }

    merged[topLevelName] = {
      ...topLevelFunction,
      url: mergeFunctionUrl(topLevelName, topLevelFunction.url, resourceFunction.url),
      events,
    };
  }

  return merged;
}

function mergeDomainStates(
  topLevel: TopLevelAdaptation,
  resourceModel: ServiceModel | undefined,
): DomainState {
  const topLevelState = readServerlessDomainStateFromConfigs(topLevel.domainConfigs);
  if (!resourceModel) return topLevelState;

  const resourceState = readServerlessDomainStateFromConfigs(resourceModel.domainConfigs);
  const logicalIdToName = new Map(
    [...topLevel.functionLogicalIds.entries()].map(([functionName, logicalId]) => [
      logicalId,
      functionName,
    ]),
  );
  const remappedResourceSns = remapSnsLambdaSubscriptionTargets(
    resourceState.sns,
    logicalIdToName,
  );

  return {
    s3: Object.fromEntries(
      [...new Set([...Object.keys(topLevelState.s3), ...Object.keys(resourceState.s3)])].map(
        (name) => [
          name,
          mergeFlatConfig("S3 bucket", name, topLevelState.s3[name], resourceState.s3[name]) ?? {},
        ],
      ),
    ),
    dynamodb: Object.fromEntries(
      [...new Set([...Object.keys(topLevelState.dynamodb), ...Object.keys(resourceState.dynamodb)])].map(
        (name) => [
          name,
          mergeFlatConfig(
            "DynamoDB table",
            name,
            topLevelState.dynamodb[name],
            resourceState.dynamodb[name],
          ),
        ],
      ).filter(([, value]) => value !== undefined),
    ) as DomainState["dynamodb"],
    sqs: Object.fromEntries(
      [...new Set([...Object.keys(topLevelState.sqs), ...Object.keys(resourceState.sqs)])].map(
        (name) => [
          name,
          mergeFlatConfig("SQS queue", name, topLevelState.sqs[name], resourceState.sqs[name]) ?? {},
        ],
      ),
    ),
    sns: Object.fromEntries(
      [...new Set([...Object.keys(topLevelState.sns), ...Object.keys(remappedResourceSns)])].map(
        (name) => [
          name,
          mergeSnsTopicConfig(name, topLevelState.sns[name], remappedResourceSns[name]) ?? {},
        ],
      ),
    ),
    cloudfront: {
      cachePolicies: {
        ...topLevelState.cloudfront.cachePolicies,
        ...resourceState.cloudfront.cachePolicies,
      },
      originRequestPolicies: {
        ...topLevelState.cloudfront.originRequestPolicies,
        ...resourceState.cloudfront.originRequestPolicies,
      },
      distributions: {
        ...topLevelState.cloudfront.distributions,
        ...resourceState.cloudfront.distributions,
      },
    },
  };
}

function validateManagedReferences(
  functions: Record<string, FunctionModel>,
  domains: DomainState,
): void {
  for (const [functionName, fn] of Object.entries(functions)) {
    for (const event of fn.events) {
      if (event.type === "s3" && !domains.s3[event.bucket]) {
        throw new Error(
          `Function "${functionName}" references S3 bucket "${event.bucket}" but no managed bucket could be derived for it.`,
        );
      }
      if (event.type === "sqs" && !domains.sqs[event.queue]) {
        throw new Error(
          `Function "${functionName}" references SQS queue "${event.queue}" but no managed queue could be derived for it.`,
        );
      }
      if (event.type === "sns" && !domains.sns[event.topic]) {
        throw new Error(
          `Function "${functionName}" references SNS topic "${event.topic}" but no managed topic could be derived for it.`,
        );
      }
      if (
        event.type === "dynamodb-stream" &&
        !domains.dynamodb[event.table]
      ) {
        throw new Error(
          `Function "${functionName}" references DynamoDB stream "${event.table}" but yamlcdk could not derive that table from resources.Resources.`,
        );
      }
    }
  }
}

interface AdaptServerlessConfigOptions {
  opt?: Record<string, unknown>;
}

export function adaptServerlessConfig(
  parsed: unknown,
  filePath: string,
  options: AdaptServerlessConfigOptions = {},
): ServiceModel {
  if (parsed === null || typeof parsed !== "object" || Array.isArray(parsed)) {
    throw new Error(`Failed to parse serverless.yml: ${filePath}`);
  }

  const resolved = resolveServerlessVariables(parsed, {
    filePath,
    opt: options.opt,
  }) as Record<string, unknown>;
  const topLevel = adaptTopLevelServerlessConfig(resolved);
  const resourceModel = adaptServerlessResources(resolved, topLevel, filePath);
  const mergedFunctions = mergeFunctions(topLevel, resourceModel);
  const mergedDomains = mergeDomainStates(topLevel, resourceModel);

  validateManagedReferences(mergedFunctions, mergedDomains);

  const domainConfigs = new DomainConfigs();
  writeServerlessDomainStateToConfigs(domainConfigs, mergedDomains);

  return parseServiceModel({
    service: topLevel.service,
    stackName: topLevel.stackName,
    provider: topLevel.provider,
    functions: mergedFunctions,
    iam: { statements: {} },
    domainConfigs,
    passthroughOutputs: resourceModel?.passthroughOutputs,
  });
}
