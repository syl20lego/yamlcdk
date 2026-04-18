import * as lambdaEventSources from "aws-cdk-lib/aws-lambda-event-sources";
import * as sqs from "aws-cdk-lib/aws-sqs";
import { Duration } from "aws-cdk-lib";
import { withStageName } from "../../compiler/stack/helpers.js";
import { normalizeManagedResourceRef } from "../../compiler/resource-refs.js";
import { SQS_CONFIG } from "./model.js";
import type { DomainPlugin } from "../../compiler/plugins/index.js";

export const sqsDomain: DomainPlugin = {
  name: "sqs",

  synthesize(ctx) {
    const config = ctx.model.domainConfigs.get(SQS_CONFIG);
    if (!config) return;

    for (const [name, queue] of Object.entries(config.queues)) {
      const queueResource = new sqs.Queue(ctx.stack, `Queue${name}`, {
        queueName: withStageName(name, ctx.model.provider.stage),
        visibilityTimeout: queue.visibilityTimeout
          ? Duration.seconds(queue.visibilityTimeout)
          : undefined,
      });
      ctx.refs[name] = queueResource;
      ctx.availableOutputs.set(`${name}QueueUrl`, queueResource.queueUrl);
      ctx.availableOutputs.set(`${name}QueueArn`, queueResource.queueArn);
    }
  },

  bind(ctx, events) {
    for (const event of events) {
      if (event.type !== "sqs") continue;
      const refName = normalizeManagedResourceRef(event.queue);
      const queue = ctx.refs[refName];
      if (!queue || !("queueArn" in queue)) {
        throw new Error(
          `SQS event references unknown queue "${refName}". ` +
            `Define it under messaging.sqs and reference it as "<name>" or "ref:<name>".`,
        );
      }
      event.fnResource.addEventSource(
        new lambdaEventSources.SqsEventSource(queue as sqs.Queue, {
          batchSize: event.batchSize ?? 10,
        }),
      );
    }
  },
};

