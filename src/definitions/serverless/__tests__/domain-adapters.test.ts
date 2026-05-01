import { describe, expect, test } from "vitest";
import { DomainConfigs } from "../../../compiler/plugins/domain-configs.js";
import { readServerlessDomainStateFromConfigs, writeServerlessDomainStateToConfigs } from "../domain-adapters.js";
import { APIS_CONFIG } from "../../../domains/apis/model.js";
import { CLOUDFRONT_CONFIG } from "../../../domains/cloudfront/model.js";
import { DYNAMODB_CONFIG } from "../../../domains/dynamodb/model.js";
import { S3_CONFIG } from "../../../domains/s3/model.js";
import { SNS_CONFIG } from "../../../domains/sns/model.js";
import { SQS_CONFIG } from "../../../domains/sqs/model.js";
import { EVENTBRIDGE_CONFIG } from "../../../domains/eventbridge/model.js";
import { OPENSEARCH_SERVERLESS_CONFIG } from "../../../domains/opensearchserverless/model.js";
import { KINESIS_FIREHOSE_CONFIG } from "../../../domains/kinesisfirehose/model.js";

describe("serverless domain adapters", () => {
  test("readServerlessDomainStateFromConfigs reads all configured domain slices", () => {
    const configs = new DomainConfigs();
    configs.set(S3_CONFIG, {
      buckets: { uploads: { versioned: true } },
      cleanupRoleArn: "arn:aws:iam::123456789012:role/cleanup",
    });
    configs.set(DYNAMODB_CONFIG, {
      tables: {
        OrdersTable: {
          partitionKey: { name: "pk", type: "string" },
        },
      },
    });
    configs.set(SQS_CONFIG, { queues: { JobsQueue: { visibilityTimeout: 45 } } });
    configs.set(SNS_CONFIG, { topics: { EventsTopic: {} } });
    configs.set(EVENTBRIDGE_CONFIG, { eventBuses: { CustomBus: { eventBusName: "marketing" } } });
    configs.set(APIS_CONFIG, { restApi: { cloudWatchRoleArn: "arn:aws:iam::123456789012:role/apigw" } });
    configs.set(CLOUDFRONT_CONFIG, {
      cachePolicies: {},
      originRequestPolicies: {},
      distributions: {},
    });
    configs.set(OPENSEARCH_SERVERLESS_CONFIG, {
      collections: {
        SearchCollection: {
          name: "search-dev",
          type: "SEARCH",
        },
      },
      accessPolicies: {},
      securityPolicies: {},
      vpcEndpoints: {},
      autoCreatePolicies: false,
    });
    configs.set(KINESIS_FIREHOSE_CONFIG, {
      streams: {
        AuditStream: {
          properties: {
            ExtendedS3DestinationConfiguration: {
              BucketARN: "arn:aws:s3:::audit-bucket",
              RoleARN: "arn:aws:iam::123456789012:role/FirehoseRole",
            },
          },
        },
      },
      helperDefaults: true,
    });

    const state = readServerlessDomainStateFromConfigs(configs);

    expect(state.s3).toEqual({ uploads: { versioned: true } });
    expect(state.dynamodb).toEqual({
      OrdersTable: { partitionKey: { name: "pk", type: "string" } },
    });
    expect(state.sqs).toEqual({ JobsQueue: { visibilityTimeout: 45 } });
    expect(state.sns).toEqual({ EventsTopic: {} });
    expect(state.eventbridge).toEqual({ CustomBus: { eventBusName: "marketing" } });
    expect(state.cloudfront).toEqual({
      cachePolicies: {},
      originRequestPolicies: {},
      distributions: {},
    });
    expect(state.opensearchserverless).toEqual({
      collections: {
        SearchCollection: {
          name: "search-dev",
          type: "SEARCH",
        },
      },
      accessPolicies: {},
      securityPolicies: {},
      vpcEndpoints: {},
      autoCreatePolicies: false,
    });
    expect(state.kinesisfirehose).toEqual({
      streams: {
        AuditStream: {
          properties: {
            ExtendedS3DestinationConfiguration: {
              BucketARN: "arn:aws:s3:::audit-bucket",
              RoleARN: "arn:aws:iam::123456789012:role/FirehoseRole",
            },
          },
        },
      },
      helperDefaults: true,
    });
  });

  test("writeServerlessDomainStateToConfigs writes all domain slices with expected wrappers", () => {
    const configs = new DomainConfigs();

    writeServerlessDomainStateToConfigs(configs, {
      s3: { assets: { versioned: true } },
      dynamodb: {
        Inventory: {
          partitionKey: { name: "pk", type: "string" },
        },
      },
      sqs: { QueueA: { visibilityTimeout: 30 } },
      sns: { TopicA: { displayName: "topic-a" } },
      eventbridge: { CustomBus: { eventBusName: "marketing" } },
      cloudfront: {
        cachePolicies: {},
        originRequestPolicies: {},
        distributions: {},
      },
      opensearchserverless: {
        collections: {
          SearchCollection: {
            type: "SEARCH",
          },
        },
        accessPolicies: {},
        securityPolicies: {},
        vpcEndpoints: {},
        autoCreatePolicies: true,
      },
      kinesisfirehose: {
        streams: {
          AuditStream: {
            type: "DirectPut",
            properties: {
              ExtendedS3DestinationConfiguration: {
                BucketARN: "arn:aws:s3:::audit-bucket",
                RoleARN: "arn:aws:iam::123456789012:role/FirehoseRole",
              },
            },
          },
        },
        helperDefaults: true,
      },
    });

    expect(configs.require(S3_CONFIG)).toEqual({ buckets: { assets: { versioned: true } } });
    expect(configs.require(DYNAMODB_CONFIG)).toEqual({
      tables: { Inventory: { partitionKey: { name: "pk", type: "string" } } },
    });
    expect(configs.require(SQS_CONFIG)).toEqual({
      queues: { QueueA: { visibilityTimeout: 30 } },
    });
    expect(configs.require(SNS_CONFIG)).toEqual({
      topics: { TopicA: { displayName: "topic-a" } },
    });
    expect(configs.require(EVENTBRIDGE_CONFIG)).toEqual({
      eventBuses: { CustomBus: { eventBusName: "marketing" } },
    });
    expect(configs.require(APIS_CONFIG)).toEqual({ restApi: undefined });
    expect(configs.require(CLOUDFRONT_CONFIG)).toEqual({
      cachePolicies: {},
      originRequestPolicies: {},
      distributions: {},
    });
    expect(configs.require(OPENSEARCH_SERVERLESS_CONFIG)).toEqual({
      collections: {
        SearchCollection: {
          type: "SEARCH",
        },
      },
      accessPolicies: {},
      securityPolicies: {},
      vpcEndpoints: {},
      autoCreatePolicies: true,
    });
    expect(configs.require(KINESIS_FIREHOSE_CONFIG)).toEqual({
      streams: {
        AuditStream: {
          type: "DirectPut",
          properties: {
            ExtendedS3DestinationConfiguration: {
              BucketARN: "arn:aws:s3:::audit-bucket",
              RoleARN: "arn:aws:iam::123456789012:role/FirehoseRole",
            },
          },
        },
      },
      helperDefaults: true,
    });
  });
});
