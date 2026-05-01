import * as lambdaEventSources from "aws-cdk-lib/aws-lambda-event-sources";
import * as sqs from "aws-cdk-lib/aws-sqs";
import { Duration, Token } from "aws-cdk-lib";
import { withStageName } from "../../compiler/stack/helpers.js";
import { normalizeManagedResourceRef } from "../../compiler/resource-refs.js";
import { SQS_CONFIG } from "./model.js";
import type { DomainPlugin } from "../../compiler/plugins/index.js";

function isKnownFifoQueueArn(queueRef: string): boolean {
  if (Token.isUnresolved(queueRef) || !queueRef.startsWith("arn:")) {
    return false;
  }
  const queueName = queueRef.split(":").at(-1) ?? "";
  return queueName.toLowerCase().endsWith(".fifo");
}

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
    const externalQueues = new Map<string, sqs.IQueue>();

    for (const event of events) {
      if (event.type !== "sqs") continue;

      let queue: sqs.IQueue;
      if (event.queue.startsWith("arn:") || Token.isUnresolved(event.queue)) {
        const existing = externalQueues.get(event.queue);
        if (existing) {
          queue = existing;
        } else {
          queue = sqs.Queue.fromQueueArn(
            ctx.stack,
            `ExternalQueue${externalQueues.size + 1}`,
            event.queue,
          );
          externalQueues.set(event.queue, queue);
        }
      } else {
        const refName = normalizeManagedResourceRef(event.queue);
        const managedQueue = ctx.refs[refName];
        if (!managedQueue || !("queueArn" in managedQueue)) {
          throw new Error(
            `SQS event references unknown queue "${refName}". ` +
              `Define it under messaging.sqs and reference it as "<name>" or "ref:<name>", ` +
              `or provide an SQS queue ARN for external queues.`,
          );
        }
        queue = managedQueue as sqs.IQueue;
      }

      const batchSize = event.batchSize ?? 10;
      if (batchSize > 10 && isKnownFifoQueueArn(event.queue)) {
        throw new Error(
          `SQS event for function "${event.functionName}" targets a FIFO queue; batchSize must be <= 10.`,
        );
      }

      event.fnResource.addEventSource(
        new lambdaEventSources.SqsEventSource(queue, {
          batchSize,
          maxBatchingWindow:
            event.maximumBatchingWindow !== undefined
              ? Duration.seconds(event.maximumBatchingWindow)
              : undefined,
        }),
      );
    }
  },
};
