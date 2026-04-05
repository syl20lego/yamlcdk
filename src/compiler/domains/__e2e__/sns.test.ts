import { Match } from "aws-cdk-lib/assertions";
import { describe, test } from "vitest";
import { functionConfig, synthServiceConfig } from "./helpers.js";

describe("sns domain e2e", () => {
  test("creates a topic without subscriptions by default", () => {
    const { template } = synthServiceConfig({
      messaging: {
        sns: { alerts: {} },
      },
    });

    template.resourceCountIs("AWS::SNS::Topic", 1);
    template.resourceCountIs("AWS::SNS::Subscription", 0);
  });

  test("creates an sns to sqs subscription when configured", () => {
    const { template } = synthServiceConfig({
      messaging: {
        sqs: { jobs: {} },
        sns: {
          alerts: {
            subscriptions: [{ type: "sqs", target: "jobs" }],
          },
        },
      },
    });

    template.hasResourceProperties(
      "AWS::SNS::Subscription",
      Match.objectLike({
        Protocol: "sqs",
      }),
    );
  });

  test("creates an sns lambda subscription for an sns function event", () => {
    const { template } = synthServiceConfig({
      functions: {
        processor: functionConfig({
          events: {
            sns: [{ topic: "ref:alerts" }],
          },
        }),
      },
      messaging: {
        sns: { alerts: {} },
      },
    });

    template.hasResourceProperties(
      "AWS::SNS::Subscription",
      Match.objectLike({
        Protocol: "lambda",
      }),
    );
  });
});
