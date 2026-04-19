import { Match } from "aws-cdk-lib/assertions";
import { describe, expect, test } from "vitest";
import {
  firstResourceOfType,
  functionConfig,
  synthServiceConfig,
  type ResourceDefinition,
} from "./helpers.js";

describe("dynamodb domain e2e", () => {
  test("creates a table with the required partition key only", () => {
    const { template } = synthServiceConfig({
      storage: {
        dynamodb: {
          orders: {
            partitionKey: { name: "pk", type: "string" },
          },
        },
      },
    });

    template.hasResourceProperties(
      "AWS::DynamoDB::Table",
      Match.objectLike({
        KeySchema: Match.arrayWith([
          Match.objectLike({
            AttributeName: "pk",
            KeyType: "HASH",
          }),
        ]),
      }),
    );

    const table = firstResourceOfType<ResourceDefinition>(
      template,
      "AWS::DynamoDB::Table",
    );
    expect(table?.Properties?.KeySchema).toHaveLength(1);
    expect(table?.DeletionPolicy).toBe("Delete");
    expect(table?.Properties?.StreamSpecification).toBeUndefined();
  });

  test("supports a table-level retain removal policy", () => {
    const { template } = synthServiceConfig({
      storage: {
        dynamodb: {
          orders: {
            partitionKey: { name: "pk", type: "string" },
            removalPolicy: "RETAIN",
          },
        },
      },
    });

    const table = firstResourceOfType<ResourceDefinition>(
      template,
      "AWS::DynamoDB::Table",
    );
    expect(table?.DeletionPolicy).toBe("Retain");
  });

  test("adds sort key and stream settings when the optional fields are configured", () => {
    const { template } = synthServiceConfig({
      storage: {
        dynamodb: {
          orders: {
            partitionKey: { name: "pk", type: "string" },
            sortKey: { name: "sk", type: "number" },
            stream: "NEW_AND_OLD_IMAGES",
          },
        },
      },
    });

    template.hasResourceProperties(
      "AWS::DynamoDB::Table",
      Match.objectLike({
        KeySchema: Match.arrayWith([
          Match.objectLike({
            AttributeName: "pk",
            KeyType: "HASH",
          }),
          Match.objectLike({
            AttributeName: "sk",
            KeyType: "RANGE",
          }),
        ]),
        StreamSpecification: {
          StreamViewType: "NEW_AND_OLD_IMAGES",
        },
      }),
    );
  });

  test("creates an event source mapping for a dynamodb stream event", () => {
    const { template } = synthServiceConfig({
      functions: {
        processor: functionConfig({
          events: {
            dynamodb: [{ table: "ref:orders", startingPosition: "LATEST" }],
          },
        }),
      },
      storage: {
        dynamodb: {
          orders: {
            partitionKey: { name: "pk", type: "string" },
            stream: "NEW_AND_OLD_IMAGES",
          },
        },
      },
    });

    template.hasResourceProperties(
      "AWS::Lambda::EventSourceMapping",
      Match.objectLike({
        StartingPosition: "LATEST",
      }),
    );
  });

  test("attaches stream permissions when using a direct Lambda role ARN", () => {
    const { template } = synthServiceConfig({
      provider: {
        account: "123456789012",
        region: "us-east-1",
      },
      functions: {
        processor: functionConfig({
          iam: ["arn:aws:iam::123456789012:role/ExistingLambdaRole"],
          events: {
            dynamodb: [{ table: "ref:orders", startingPosition: "LATEST" }],
          },
        }),
      },
      storage: {
        dynamodb: {
          orders: {
            partitionKey: { name: "pk", type: "string" },
            stream: "NEW_AND_OLD_IMAGES",
          },
        },
      },
    });

    template.resourceCountIs("AWS::IAM::Role", 0);
    template.resourceCountIs("AWS::IAM::Policy", 1);
    template.hasResourceProperties(
      "AWS::IAM::Policy",
      Match.objectLike({
        Roles: Match.arrayWith(["ExistingLambdaRole"]),
      }),
    );
  });
});
