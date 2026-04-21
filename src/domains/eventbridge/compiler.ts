import * as events from "aws-cdk-lib/aws-events";
import * as targets from "aws-cdk-lib/aws-events-targets";
import { withStageName } from "../../compiler/stack/helpers.js";
import type { DomainPlugin } from "../../compiler/plugins/index.js";

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

      const eventBus = event.eventBus
        ? events.EventBus.fromEventBusArn(
            ctx.stack,
            `EventBus${event.functionName}${ruleIndex}`,
            event.eventBus,
          )
        : undefined;

      const ruleProps: events.RuleProps = {
        ruleName,
        eventBus,
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

