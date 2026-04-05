/**
 * yamlcdk.yml definition plugin.
 *
 * Translates the native yamlcdk YAML format into the canonical
 * {@link ServiceModel} consumed by the compiler pipeline.
 */

import type { DefinitionPlugin } from "../../compiler/plugins/index.js";
import type { ServiceModel, EventDeclaration, FunctionModel } from "../../compiler/model.js";
import { parseServiceModel } from "../../compiler/model.js";
import { DomainConfigs } from "../../compiler/plugins/index.js";
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
    events.push({ type: "http", method: route.method, path: route.path });
  }

  const resolvedApiKey =
    globalRestApiKeyRequired ?? fn.restApi?.apiKeyRequired ?? false;
  for (const route of fn.events?.rest ?? []) {
    events.push({
      type: "rest",
      method: route.method,
      path: route.path,
      apiKeyRequired: resolvedApiKey,
    });
  }

  for (const s3Event of fn.events?.s3 ?? []) {
    events.push({
      type: "s3",
      bucket: s3Event.bucket,
      events: s3Event.events,
    });
  }

  for (const sqsEvent of fn.events?.sqs ?? []) {
    events.push({
      type: "sqs",
      queue: sqsEvent.queue,
      batchSize: sqsEvent.batchSize,
    });
  }

  for (const snsEvent of fn.events?.sns ?? []) {
    events.push({ type: "sns", topic: snsEvent.topic });
  }

  for (const dynamoEvent of fn.events?.dynamodb ?? []) {
    events.push({
      type: "dynamodb-stream",
      table: dynamoEvent.table,
      batchSize: dynamoEvent.batchSize,
      startingPosition: dynamoEvent.startingPosition,
    });
  }

  for (const ebEvent of fn.events?.eventbridge ?? []) {
    events.push({
      type: "eventbridge",
      schedule: "schedule" in ebEvent ? ebEvent.schedule : undefined,
      eventPattern:
        "eventPattern" in ebEvent
          ? (ebEvent.eventPattern as Record<string, unknown>)
          : undefined,
    });
  }

  return events;
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
    iam: { statements: config.iam.statements },
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
    events:
      http:
        - method: GET
          path: /hello
      rest:
        - method: GET
          path: /hello-rest
      sqs:
        - queue: ref:jobs
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
      resources: [ref:users]
`;

// ─── Plugin ─────────────────────────────────────────────────

export const yamlcdkDefinitionPlugin: DefinitionPlugin = {
  formatName: "yamlcdk",

  canLoad(filePath: string): boolean {
    return /\.(yml|yaml)$/i.test(filePath);
  },

  load(filePath: string): ServiceModel {
    const raw = loadRawConfig(filePath);
    const normalized = normalizeConfig(raw);
    return adaptConfig(normalized);
  },

  generateStarter(): string {
    return STARTER_TEMPLATE;
  },
};
