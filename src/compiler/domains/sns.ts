import * as sns from "aws-cdk-lib/aws-sns";
import * as snsSubscriptions from "aws-cdk-lib/aws-sns-subscriptions";
import * as sqs from "aws-cdk-lib/aws-sqs";
import { withStageName } from "../stack/helpers.js";
import { SNS_CONFIG } from "../plugins/native-domain-configs.js";
import type { DomainPlugin } from "../plugins/index.js";

export const snsDomain: DomainPlugin = {
  name: "sns",

  synthesize(ctx) {
    const config = ctx.model.domainConfigs.get(SNS_CONFIG);
    if (!config) return;

    for (const [name, topic] of Object.entries(config.topics)) {
      const topicResource = new sns.Topic(ctx.stack, `Topic${name}`, {
        topicName: withStageName(name, ctx.model.provider.stage),
      });
      ctx.refs[name] = topicResource;

      for (const subscription of topic.subscriptions ?? []) {
        if (subscription.type === "sqs") {
          const queueRef = ctx.refs[subscription.target];
          if (!queueRef || !("queueArn" in queueRef)) {
            throw new Error(
              `SNS subscription target "${subscription.target}" is not an SQS queue`,
            );
          }
          topicResource.addSubscription(
            new snsSubscriptions.SqsSubscription(queueRef as sqs.Queue),
          );
        }
      }
    }
  },

  bind(ctx, events) {
    for (const event of events) {
      if (event.type !== "sns") continue;
      const refName = event.topic.replace("ref:", "");
      const topic = ctx.refs[refName];
      if (!topic || !("topicArn" in topic)) {
        throw new Error(
          `SNS event references unknown topic "${refName}". Define it under messaging.sns.`,
        );
      }
      (topic as sns.Topic).addSubscription(
        new snsSubscriptions.LambdaSubscription(event.fnResource),
      );
    }
  },
};
