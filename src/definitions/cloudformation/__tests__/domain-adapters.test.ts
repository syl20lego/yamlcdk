import { describe, expect, test } from "vitest";
import { adaptDomainConfigsFromCloudFormation } from "../domain-adapters.js";
import { APIS_CONFIG } from "../../../domains/apis/model.js";
import { CLOUDFRONT_CONFIG } from "../../../domains/cloudfront/model.js";
import { DYNAMODB_CONFIG } from "../../../domains/dynamodb/model.js";
import { S3_CONFIG } from "../../../domains/s3/model.js";
import { SNS_CONFIG } from "../../../domains/sns/model.js";
import { SQS_CONFIG } from "../../../domains/sqs/model.js";
import { EVENTBRIDGE_CONFIG } from "../../../domains/eventbridge/model.js";

describe("adaptDomainConfigsFromCloudFormation", () => {
  test("maps each domain config to the typed DomainConfigs registry", () => {
    const input = {
      s3: {
        buckets: { UploadsBucket: { versioned: true } },
        cleanupRoleArn: "arn:aws:iam::123456789012:role/cleanup",
      },
      dynamodb: {
        tables: {
          UsersTable: {
            partitionKey: { name: "pk", type: "string" as const },
            sortKey: { name: "sk", type: "number" as const },
          },
        },
      },
      sqs: { queues: { JobsQueue: { visibilityTimeout: 30 } } },
      sns: {
        topics: {
          AlertsTopic: {
            subscriptions: [{ type: "sqs" as const, target: "JobsQueue" }],
          },
        },
      },
      eventbridge: {
        eventBuses: {
          CustomBus: {
            eventBusName: "marketing",
          },
        },
      },
      apis: {
        restApi: {
          cloudWatchRoleArn: "arn:aws:iam::123456789012:role/apigw",
        },
      },
      cloudfront: {
        cachePolicies: {},
        originRequestPolicies: {},
        distributions: {},
      },
    };

    const domainConfigs = adaptDomainConfigsFromCloudFormation(input);

    expect(domainConfigs.require(S3_CONFIG)).toEqual(input.s3);
    expect(domainConfigs.require(DYNAMODB_CONFIG)).toEqual(input.dynamodb);
    expect(domainConfigs.require(SQS_CONFIG)).toEqual(input.sqs);
    expect(domainConfigs.require(SNS_CONFIG)).toEqual(input.sns);
    expect(domainConfigs.require(EVENTBRIDGE_CONFIG)).toEqual(input.eventbridge);
    expect(domainConfigs.require(APIS_CONFIG)).toEqual(input.apis);
    expect(domainConfigs.require(CLOUDFRONT_CONFIG)).toEqual(input.cloudfront);
  });
});
