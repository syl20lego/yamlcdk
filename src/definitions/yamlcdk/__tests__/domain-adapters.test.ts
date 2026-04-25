import { describe, expect, test } from "vitest";
import { normalizeConfig } from "../../../config/normalize.js";
import { validateServiceConfig } from "../../../config/schema.js";
import { adaptDomainConfigsFromYamlcdk } from "../domain-adapters.js";
import { APIS_CONFIG } from "../../../domains/apis/model.js";
import { CLOUDFRONT_CONFIG } from "../../../domains/cloudfront/model.js";
import { DYNAMODB_CONFIG } from "../../../domains/dynamodb/model.js";
import { S3_CONFIG } from "../../../domains/s3/model.js";
import { SNS_CONFIG } from "../../../domains/sns/model.js";
import { SQS_CONFIG } from "../../../domains/sqs/model.js";

describe("adaptDomainConfigsFromYamlcdk", () => {
  test("populates S3 domain config from storage.s3", () => {
    const normalized = normalizeConfig(
      validateServiceConfig({
        service: "demo",
        provider: {
          s3: { cleanupRoleArn: "arn:aws:iam::123456789012:role/Cleanup" },
        },
        storage: {
          s3: { uploads: { versioned: true, autoDeleteObjects: true } },
        },
        functions: {},
      }),
    );

    const domainConfigs = adaptDomainConfigsFromYamlcdk(normalized);
    const s3Config = domainConfigs.require(S3_CONFIG);

    expect(s3Config.buckets.uploads.versioned).toBe(true);
    expect(s3Config.buckets.uploads.autoDeleteObjects).toBe(true);
    expect(s3Config.cleanupRoleArn).toBe(
      "arn:aws:iam::123456789012:role/Cleanup",
    );
  });

  test("populates DynamoDB domain config", () => {
    const normalized = normalizeConfig(
      validateServiceConfig({
        service: "demo",
        storage: {
          dynamodb: {
            users: {
              partitionKey: { name: "pk", type: "string" },
              removalPolicy: "RETAIN",
              stream: "NEW_AND_OLD_IMAGES",
            },
          },
        },
        functions: {},
      }),
    );

    const domainConfigs = adaptDomainConfigsFromYamlcdk(normalized);
    const dynamoConfig = domainConfigs.require(DYNAMODB_CONFIG);

    expect(dynamoConfig.tables.users.partitionKey.name).toBe("pk");
    expect(dynamoConfig.tables.users.removalPolicy).toBe("RETAIN");
    expect(dynamoConfig.tables.users.stream).toBe("NEW_AND_OLD_IMAGES");
  });

  test("populates SQS and expanded SNS domain configs", () => {
    const normalized = normalizeConfig(
      validateServiceConfig({
        service: "demo",
        messaging: {
          sqs: { jobs: { visibilityTimeout: 30 } },
          sns: {
            events: {
              topicName: "events-topic.fifo",
              displayName: "Events",
              fifoTopic: true,
              contentBasedDeduplication: true,
              fifoThroughputScope: "MessageGroup",
              kmsMasterKeyId: "alias/aws/sns",
              signatureVersion: "2",
              tracingConfig: "Active",
              archivePolicy: {
                MessageRetentionPeriod: "7",
              },
              dataProtectionPolicy: {
                Name: "events-policy",
              },
              deliveryStatusLogging: [
                {
                  protocol: "lambda",
                  successFeedbackSampleRate: "100",
                },
              ],
              tags: {
                Team: "platform",
              },
              subscriptions: [{ type: "sqs", target: "jobs" }],
            },
          },
        },
        functions: {},
      }),
    );

    const domainConfigs = adaptDomainConfigsFromYamlcdk(normalized);

    expect(domainConfigs.require(SQS_CONFIG).queues.jobs.visibilityTimeout).toBe(
      30,
    );
    expect(domainConfigs.require(SNS_CONFIG).topics.events).toEqual(
      expect.objectContaining({
        topicName: "events-topic.fifo",
        displayName: "Events",
        fifoTopic: true,
        contentBasedDeduplication: true,
        fifoThroughputScope: "MessageGroup",
        kmsMasterKeyId: "alias/aws/sns",
        signatureVersion: "2",
        tracingConfig: "Active",
        archivePolicy: {
          MessageRetentionPeriod: "7",
        },
        dataProtectionPolicy: {
          Name: "events-policy",
        },
        deliveryStatusLogging: [
          {
            protocol: "lambda",
            successFeedbackSampleRate: "100",
          },
        ],
        tags: {
          Team: "platform",
        },
      }),
    );
    expect(domainConfigs.require(SNS_CONFIG).topics.events.subscriptions).toEqual([
      {
        type: "sqs",
        target: "jobs",
      },
    ]);
  });

  test("populates APIs domain config from restApi settings", () => {
    const normalized = normalizeConfig(
      validateServiceConfig({
        service: "demo",
        provider: {
          restApi: {
            cloudWatchRoleArn: "arn:aws:iam::123456789012:role/CWRole",
          },
        },
        functions: {},
      }),
    );

    const domainConfigs = adaptDomainConfigsFromYamlcdk(normalized);
    const apisConfig = domainConfigs.require(APIS_CONFIG);

    expect(apisConfig.restApi?.cloudWatchRoleArn).toBe(
      "arn:aws:iam::123456789012:role/CWRole",
    );
  });

  test("initializes CloudFront domain config from normalized defaults", () => {
    const normalized = normalizeConfig(
      validateServiceConfig({
        service: "demo",
        functions: {},
      }),
    );

    const domainConfigs = adaptDomainConfigsFromYamlcdk(normalized);

    expect(domainConfigs.require(CLOUDFRONT_CONFIG)).toEqual({
      cachePolicies: {},
      originRequestPolicies: {},
      distributions: {},
    });
  });
});

