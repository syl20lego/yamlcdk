import { Match } from "aws-cdk-lib/assertions";
import { describe, expect, test } from "vitest";
import {
  firstResourceOfType,
  functionConfig,
  synthServiceConfig,
  type ResourceDefinition,
} from "./helpers.js";

describe("sqs domain e2e", () => {
  test("creates a queue without visibilityTimeout by default", () => {
    const { template } = synthServiceConfig({
      messaging: {
        sqs: { jobs: {} },
      },
    });

    const queue = firstResourceOfType<ResourceDefinition>(
      template,
      "AWS::SQS::Queue",
    );

    expect(queue?.Properties?.VisibilityTimeout).toBeUndefined();
  });

  test("applies visibilityTimeout when it is configured", () => {
    const { template } = synthServiceConfig({
      messaging: {
        sqs: { jobs: { visibilityTimeout: 45 } },
      },
    });

    template.hasResourceProperties(
      "AWS::SQS::Queue",
      Match.objectLike({
        VisibilityTimeout: 45,
      }),
    );
  });

  test("creates an event source mapping for an sqs event", () => {
    const { template } = synthServiceConfig({
      functions: {
        processor: functionConfig({
          events: {
            sqs: [{ queue: "ref:jobs", batchSize: 5 }],
          },
        }),
      },
      messaging: {
        sqs: { jobs: {} },
      },
    });

    template.hasResourceProperties(
      "AWS::Lambda::EventSourceMapping",
      Match.objectLike({
        BatchSize: 5,
      }),
    );
  });
});
