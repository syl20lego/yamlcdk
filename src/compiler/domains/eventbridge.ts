import * as events from "aws-cdk-lib/aws-events";
import * as targets from "aws-cdk-lib/aws-events-targets";
import { withStageName } from "../stack/helpers.js";
import type { DomainPlugin } from "../plugins/index.js";

export const eventbridgeDomain: DomainPlugin = {
  name: "eventbridge",

  bind(ctx, allEvents) {
    let ruleIndex = 0;

    for (const event of allEvents) {
      if (event.type !== "eventbridge") continue;
      ruleIndex++;
      const ruleName = withStageName(
        `${event.functionName}-rule-${ruleIndex}`,
        ctx.model.provider.stage,
      );

      const ruleProps: events.RuleProps = {
        ruleName,
        targets: [new targets.LambdaFunction(event.fnResource)],
      };

      if (event.schedule) {
        new events.Rule(
          ctx.stack,
          `EventBridgeRule${event.functionName}${ruleIndex}`,
          { ...ruleProps, schedule: events.Schedule.expression(event.schedule) },
        );
      } else if (event.eventPattern) {
        new events.Rule(
          ctx.stack,
          `EventBridgeRule${event.functionName}${ruleIndex}`,
          {
            ...ruleProps,
            eventPattern: event.eventPattern as events.EventPattern,
          },
        );
      }
    }
  },
};
