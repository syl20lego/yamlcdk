import { Match } from "aws-cdk-lib/assertions";
import { describe, test } from "vitest";
import { functionConfig, synthServiceConfig } from "./helpers.js";

describe("eventbridge domain e2e", () => {
  test("creates a rule for a schedule event", () => {
    const { template } = synthServiceConfig({
      functions: {
        processor: functionConfig({
          events: {
            eventbridge: [{ schedule: "rate(5 minutes)" }],
          },
        }),
      },
    });

    template.hasResourceProperties(
      "AWS::Events::Rule",
      Match.objectLike({
        ScheduleExpression: "rate(5 minutes)",
      }),
    );
  });

  test("creates a rule for an event pattern", () => {
    const { template } = synthServiceConfig({
      functions: {
        processor: functionConfig({
          events: {
            eventbridge: [{ eventPattern: { source: ["orders"] } }],
          },
        }),
      },
    });

    template.hasResourceProperties(
      "AWS::Events::Rule",
      Match.objectLike({
        EventPattern: {
          source: ["orders"],
        },
      }),
    );
  });

  test("creates a rule targeting a custom event bus by ARN", () => {
    const busArn = "arn:aws:events:us-east-1:123456789012:event-bus/custom-bus";
    const { template } = synthServiceConfig({
      functions: {
        processor: functionConfig({
          events: {
            eventbridge: [
              {
                eventPattern: {
                  source: ["marketing"],
                  "detail-type": ["SEND_EMAIL"],
                },
                eventBus: busArn,
              },
            ],
          },
        }),
      },
    });

    template.hasResourceProperties(
      "AWS::Events::Rule",
      Match.objectLike({
        EventBusName: "custom-bus",
        EventPattern: {
          source: ["marketing"],
          "detail-type": ["SEND_EMAIL"],
        },
      }),
    );
  });

  test("creates a rule targeting a custom event bus by name", () => {
    const { template } = synthServiceConfig({
      functions: {
        processor: functionConfig({
          events: {
            eventbridge: [
              {
                eventPattern: {
                  source: ["marketing"],
                  "detail-type": ["SEND_EMAIL"],
                },
                eventBus: "marketing",
              },
            ],
          },
        }),
      },
    });

    template.hasResourceProperties(
      "AWS::Events::Rule",
      Match.objectLike({
        EventBusName: "marketing",
      }),
    );
  });

  test("creates and targets a managed EventBus via Ref", () => {
    const { template } = synthServiceConfig({
      messaging: {
        eventbridge: {
          customBus: {
            eventBusName: "marketing",
            description: "Marketing event bus",
          },
        },
      },
      functions: {
        processor: functionConfig({
          events: {
            eventbridge: [
              {
                eventPattern: { source: ["marketing"] },
                eventBus: { Ref: "customBus" },
              },
            ],
          },
        }),
      },
    });

    template.resourceCountIs("AWS::Events::EventBus", 1);
    template.hasResourceProperties(
      "AWS::Events::EventBus",
      Match.objectLike({
        Name: "marketing",
        Description: "Marketing event bus",
      }),
    );
    template.hasResourceProperties(
      "AWS::Events::Rule",
      Match.objectLike({
        EventBusName: { Ref: Match.anyValue() },
      }),
    );
  });
});
