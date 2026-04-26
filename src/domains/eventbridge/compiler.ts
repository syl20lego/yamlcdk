import * as events from "aws-cdk-lib/aws-events";
import * as targets from "aws-cdk-lib/aws-events-targets";
import * as cdk from "aws-cdk-lib";
import { withStageName } from "../../compiler/stack/helpers.js";
import { normalizeManagedResourceRef } from "../../compiler/resource-refs.js";
import type { DomainPlugin } from "../../compiler/plugins/index.js";
import { EVENTBRIDGE_CONFIG } from "./model.js";

function resolveManagedEventBus(
  refs: Record<string, unknown>,
  name: string,
): events.IEventBus | undefined {
  const refName = normalizeManagedResourceRef(name);
  const busRef = refs[refName];
  if (!busRef || !("eventBusArn" in (busRef as Record<string, unknown>))) {
    return undefined;
  }
  return busRef as events.IEventBus;
}

function resolveEventBus(
  ctx: Parameters<NonNullable<DomainPlugin["bind"]>>[0],
  event: Extract<Parameters<NonNullable<DomainPlugin["bind"]>>[1][number], { type: "eventbridge" }>,
  importId: string,
): events.IEventBus | undefined {
  if (!event.eventBus) return undefined;

  if (typeof event.eventBus === "string") {
    const managedBus = resolveManagedEventBus(ctx.refs, event.eventBus);
    if (managedBus) return managedBus;
    return event.eventBus.startsWith("arn:")
      ? events.EventBus.fromEventBusArn(ctx.stack, importId, event.eventBus)
      : events.EventBus.fromEventBusName(ctx.stack, importId, event.eventBus);
  }

  if ("Ref" in event.eventBus) {
    const managedBus = resolveManagedEventBus(ctx.refs, event.eventBus.Ref);
    if (managedBus) return managedBus;
    return events.EventBus.fromEventBusName(
      ctx.stack,
      importId,
      cdk.Fn.ref(event.eventBus.Ref),
    );
  }

  const [logicalId, attribute] = event.eventBus["Fn::GetAtt"];
  const managedBus = resolveManagedEventBus(ctx.refs, logicalId);
  if (managedBus) return managedBus;

  const tokenValue = cdk.Token.asString(cdk.Fn.getAtt(logicalId, attribute));
  if (attribute === "Arn") {
    return events.EventBus.fromEventBusArn(ctx.stack, importId, tokenValue);
  }
  if (attribute === "Name") {
    return events.EventBus.fromEventBusName(ctx.stack, importId, tokenValue);
  }
  throw new Error(
    `EventBridge event bus Fn::GetAtt attribute "${attribute}" is not supported. Use "Arn" or "Name".`,
  );
}

export const eventbridgeDomain: DomainPlugin = {
  name: "eventbridge",

  synthesize(ctx) {
    const config = ctx.model.domainConfigs.get(EVENTBRIDGE_CONFIG);
    if (!config) return;

    for (const [name, eventBus] of Object.entries(config.eventBuses)) {
      const eventBusResource = new events.EventBus(ctx.stack, `EventBus${name}`, {
        eventBusName: eventBus.eventBusName,
        eventSourceName: eventBus.eventSourceName,
        description: eventBus.description,
      });
      ctx.refs[name] = eventBusResource;
      ctx.availableOutputs.set(`${name}EventBusArn`, eventBusResource.eventBusArn);
      ctx.availableOutputs.set(`${name}EventBusName`, eventBusResource.eventBusName);
    }
  },

  bind(ctx, allEvents) {
    let ruleIndex = 0;

    for (const event of allEvents) {
      if (event.type !== "eventbridge") continue;
      ruleIndex++;
      const ruleName = withStageName(
        `${event.functionName}-rule-${ruleIndex}`,
        ctx.model.provider.stage,
      );

      const eventBus = resolveEventBus(
        ctx,
        event,
        `EventBus${event.functionName}${ruleIndex}`,
      );

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
