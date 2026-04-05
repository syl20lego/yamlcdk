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
});
