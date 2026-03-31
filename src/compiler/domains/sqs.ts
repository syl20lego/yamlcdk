import * as lambdaEventSources from "aws-cdk-lib/aws-lambda-event-sources";
import * as sqs from "aws-cdk-lib/aws-sqs";
import { Duration } from "aws-cdk-lib";
import { withStageName } from "../stack/helpers.js";
import { SQS_CONFIG } from "../plugins/native-domain-configs.js";
import type { DomainPlugin } from "../plugins/index.js";

export const sqsDomain: DomainPlugin = {
  name: "sqs",

  synthesize(ctx) {
    const config = ctx.model.domainConfigs.get(SQS_CONFIG);
    if (!config) return;

    for (const [name, queue] of Object.entries(config.queues)) {
      ctx.refs[name] = new sqs.Queue(ctx.stack, `Queue${name}`, {
        queueName: withStageName(name, ctx.model.provider.stage),
        visibilityTimeout: queue.visibilityTimeout
          ? Duration.seconds(queue.visibilityTimeout)
          : undefined,
      });
    }
  },

  bind(ctx, events) {
    for (const event of events) {
      if (event.type !== "sqs") continue;
      const refName = event.queue.replace("ref:", "");
      const queue = ctx.refs[refName];
      if (!queue || !("queueArn" in queue)) {
        throw new Error(
          `SQS event references unknown queue "${refName}". Define it under messaging.sqs.`,
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
