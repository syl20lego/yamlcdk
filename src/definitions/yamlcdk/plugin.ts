/**
 * yamlcdk.yml definition plugin.
 *
 * Translates the native yamlcdk YAML format into the canonical
 * {@link ServiceModel} consumed by the compiler pipeline.
 */

import type { DefinitionPlugin } from "../../compiler/plugins/index.js";
import type { DefinitionPluginLoadOptions } from "../../compiler/plugins/index.js";
import type {
  ServiceModel,
  EventDeclaration,
  FunctionModel,
  FunctionUrlConfig,
} from "../../compiler/model.js";
import { parseServiceModel } from "../../compiler/model.js";
import { DomainConfigs } from "../../compiler/plugins/index.js";
import { normalizeManagedResourceRef } from "../../compiler/resource-refs.js";
import path from "node:path";
import {
  createDynamodbStreamEvent,
  createEventBridgeEvent,
  createHttpEvent,
  createRestEvent,
  createS3Event,
  createSnsEvent,
  createSqsEvent,
} from "../shared-event-adapters.js";
import {
  S3_CONFIG,
  DYNAMODB_CONFIG,
  SQS_CONFIG,
  SNS_CONFIG,
  APIS_CONFIG,
} from "../../compiler/plugins/native-domain-configs.js";
import { loadRawConfig } from "../../config/load.js";
import { normalizeConfig } from "../../config/normalize.js";
import type { NormalizedServiceConfig } from "../../config/normalize.js";

// ─── Config → ServiceModel adaptation ───────────────────────

function adaptEvents(
  fn: NormalizedServiceConfig["functions"][string],
  globalRestApiKeyRequired: boolean | undefined,
): EventDeclaration[] {
  const events: EventDeclaration[] = [];

  for (const route of fn.events?.http ?? []) {
    events.push(createHttpEvent(route.method, route.path));
  }

  const resolvedApiKey =
    globalRestApiKeyRequired ?? fn.restApi?.apiKeyRequired ?? false;
  for (const route of fn.events?.rest ?? []) {
    events.push(createRestEvent(route.method, route.path, resolvedApiKey));
  }

  for (const s3Event of fn.events?.s3 ?? []) {
    events.push(
      createS3Event(
        normalizeManagedResourceRef(s3Event.bucket),
        s3Event.events,
      ),
    );
  }

  for (const sqsEvent of fn.events?.sqs ?? []) {
    events.push(
      createSqsEvent(
        normalizeManagedResourceRef(sqsEvent.queue),
        sqsEvent.batchSize,
      ),
    );
  }

  for (const snsEvent of fn.events?.sns ?? []) {
    events.push(createSnsEvent(normalizeManagedResourceRef(snsEvent.topic)));
  }

  for (const dynamoEvent of fn.events?.dynamodb ?? []) {
    events.push(
      createDynamodbStreamEvent(
        normalizeManagedResourceRef(dynamoEvent.table),
        dynamoEvent.batchSize,
        dynamoEvent.startingPosition,
      ),
    );
  }

  for (const ebEvent of fn.events?.eventbridge ?? []) {
    events.push(
      createEventBridgeEvent({
        schedule: "schedule" in ebEvent ? ebEvent.schedule : undefined,
        eventPattern:
          "eventPattern" in ebEvent
            ? (ebEvent.eventPattern as Record<string, unknown>)
            : undefined,
      }),
    );
  }

  return events;
}

function adaptFunctionUrl(
  fn: NormalizedServiceConfig["functions"][string],
): FunctionUrlConfig | undefined {
  if (!fn.url) return undefined;

  return {
    authType: fn.url.authType ?? "AWS_IAM",
    cors: fn.url.cors,
    invokeMode: fn.url.invokeMode ?? "BUFFERED",
  };
}

function adaptFunctions(
  config: NormalizedServiceConfig,
): Record<string, FunctionModel> {
  const globalRestApiKeyRequired = config.provider.restApi?.apiKeyRequired;
  const result: Record<string, FunctionModel> = {};

  for (const [name, fn] of Object.entries(config.functions)) {
    result[name] = {
      handler: fn.handler,
      runtime: fn.runtime,
      timeout: fn.timeout,
      memorySize: fn.memorySize,
      environment: fn.environment,
      iam: fn.iam,
      url: adaptFunctionUrl(fn),
      build: fn.build,
      events: adaptEvents(fn, globalRestApiKeyRequired),
    };
  }

  return result;
}

function adaptDomainConfigs(config: NormalizedServiceConfig): DomainConfigs {
  const dc = new DomainConfigs();

  dc.set(S3_CONFIG, {
    buckets: config.storage.s3,
    cleanupRoleArn: config.provider.s3?.cleanupRoleArn,
  });

  dc.set(DYNAMODB_CONFIG, { tables: config.storage.dynamodb });
  dc.set(SQS_CONFIG, { queues: config.messaging.sqs });
  dc.set(SNS_CONFIG, { topics: config.messaging.sns });
  dc.set(APIS_CONFIG, {
    restApi: config.provider.restApi
      ? { cloudWatchRoleArn: config.provider.restApi.cloudWatchRoleArn }
      : undefined,
  });

  return dc;
}

function adaptIam(config: NormalizedServiceConfig): ServiceModel["iam"] {
  return {
    statements: Object.fromEntries(
      Object.entries(config.iam.statements).map(([name, statement]) => [
        name,
        {
          ...statement,
          resources: statement.resources.map((resource) =>
            normalizeManagedResourceRef(resource),
          ),
        },
      ]),
    ),
  };
}

export function adaptConfig(config: NormalizedServiceConfig): ServiceModel {
  return parseServiceModel({
    service: config.service,
    stackName: config.stackName,
    provider: {
      region: config.provider.region,
      stage: config.provider.stage,
      account: config.provider.account,
      profile: config.provider.profile,
      tags: config.provider.tags,
      deployment: config.provider.deployment,
    },
    functions: adaptFunctions(config),
    iam: adaptIam(config),
    domainConfigs: adaptDomainConfigs(config),
  });
}

// ─── Starter template ───────────────────────────────────────

const STARTER_TEMPLATE = `service: my-service
provider:
  region: us-east-1
  stage: dev
  s3:
    # Optional role used for S3 object cleanup when autoDeleteObjects=true
    cleanupRoleArn: arn:aws:iam::123456789012:role/MyS3CleanupRole

functions:
  hello:
    handler: src/handlers/hello.handler
    runtime: nodejs20.x
    timeout: 10
    memorySize: 256
    environment:
      STAGE: dev
    url:
      authType: NONE
      cors:
        allowOrigins:
          - https://example.com
        allowedMethods:
          - GET
    events:
      http:
        - method: GET
          path: /hello
      rest:
        - method: GET
          path: /hello-rest
      sqs:
        - queue: jobs
          batchSize: 10

storage:
  s3:
    uploads:
      versioned: true
      autoDeleteObjects: false
  dynamodb:
    users:
      partitionKey:
        name: pk
        type: string
      billingMode: PAY_PER_REQUEST
      stream: NEW_AND_OLD_IMAGES

messaging:
  sqs:
    jobs:
      visibilityTimeout: 30
  sns:
    events:
      subscriptions:
        - type: sqs
          target: jobs

iam:
  statements:
    readUsersTable:
      actions: [dynamodb:GetItem, dynamodb:Query]
      resources: [users]
`;

// ─── Plugin ─────────────────────────────────────────────────

export const yamlcdkDefinitionPlugin: DefinitionPlugin = {
  formatName: "yamlcdk",

  canLoad(filePath: string): boolean {
    if (!/\.(yml|yaml)$/i.test(filePath)) return false;
    const basename = path.basename(filePath).toLowerCase();
    return basename !== "serverless.yml" && basename !== "serverless.yaml";
  },

  load(filePath: string, options: DefinitionPluginLoadOptions = {}): ServiceModel {
    const raw = loadRawConfig(filePath, { opt: options.opt });
    const normalized = normalizeConfig(raw);
    return adaptConfig(normalized);
  },

  generateStarter(): string {
    return STARTER_TEMPLATE;
  },
};
