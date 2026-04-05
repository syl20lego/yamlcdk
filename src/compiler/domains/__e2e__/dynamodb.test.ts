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
    expect(table?.Properties?.StreamSpecification).toBeUndefined();
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
});
