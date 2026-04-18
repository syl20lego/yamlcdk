import { Tags, type Stack } from "aws-cdk-lib";
import * as iam from "aws-cdk-lib/aws-iam";
import * as lambda from "aws-cdk-lib/aws-lambda";
import * as sns from "aws-cdk-lib/aws-sns";
import * as sqs from "aws-cdk-lib/aws-sqs";
import { tryGetLogicalId, withStageName } from "../../compiler/stack/helpers.js";
import { normalizeManagedResourceRef } from "../../compiler/resource-refs.js";
import {
  SNS_CONFIG,
  type SNSSubscriptionConfig,
  type SNSTopicConfig,
} from "./model.js";
import type { DomainPlugin } from "../../compiler/plugins/index.js";
import type { Construct } from "constructs";

function isManagedSubscription(
  subscription: SNSSubscriptionConfig,
): subscription is Extract<SNSSubscriptionConfig, { type: "sqs" | "lambda" }> {
  return "type" in subscription;
}

function resolveTopicName(
  name: string,
  stage: string,
  topic: SNSTopicConfig,
): string {
  if (topic.topicName) return topic.topicName;
  const defaultName = withStageName(name, stage);
  if (topic.fifoTopic && !defaultName.endsWith(".fifo")) {
    return `${defaultName}.fifo`;
  }
  return defaultName;
}

function resolveTopicRef(
  refs: Record<string, Construct>,
  refName: string,
): sns.Topic {
  const topicRef = refs[refName];
  if (!topicRef || !("topicArn" in topicRef)) {
    throw new Error(
      `SNS event references unknown topic "${refName}". ` +
        `Define it under messaging.sns and reference it as "<name>" or "ref:<name>".`,
    );
  }
  return topicRef as sns.Topic;
}

function createSubscription(
  scope: Construct,
  id: string,
  topicArn: string,
  protocol: string,
  endpoint: string,
  options: {
    deliveryPolicy?: Record<string, unknown>;
    filterPolicy?: Record<string, unknown>;
    filterPolicyScope?: "MessageAttributes" | "MessageBody";
    rawMessageDelivery?: boolean;
    redrivePolicy?: Record<string, unknown>;
    region?: string;
    replayPolicy?: Record<string, unknown> | string;
    subscriptionRoleArn?: string;
  },
): sns.CfnSubscription {
  return new sns.CfnSubscription(scope, id, {
    topicArn,
    protocol,
    endpoint,
    deliveryPolicy: options.deliveryPolicy,
    filterPolicy: options.filterPolicy,
    filterPolicyScope: options.filterPolicyScope,
    rawMessageDelivery: options.rawMessageDelivery,
    redrivePolicy: options.redrivePolicy,
    region: options.region,
    replayPolicy: options.replayPolicy,
    subscriptionRoleArn: options.subscriptionRoleArn,
  });
}

function attachTopicProperties(topicResource: sns.Topic, topic: SNSTopicConfig): void {
  const cfnTopic = topicResource.node.defaultChild as sns.CfnTopic;
  cfnTopic.displayName = topic.displayName;
  cfnTopic.contentBasedDeduplication = topic.contentBasedDeduplication;
  cfnTopic.fifoTopic = topic.fifoTopic;
  cfnTopic.fifoThroughputScope = topic.fifoThroughputScope;
  cfnTopic.kmsMasterKeyId = topic.kmsMasterKeyId;
  cfnTopic.signatureVersion = topic.signatureVersion;
  cfnTopic.tracingConfig = topic.tracingConfig;
  cfnTopic.archivePolicy = topic.archivePolicy;
  cfnTopic.dataProtectionPolicy = topic.dataProtectionPolicy;
  cfnTopic.deliveryStatusLogging = topic.deliveryStatusLogging;

  for (const [key, value] of Object.entries(topic.tags ?? {})) {
    Tags.of(topicResource).add(key, value);
  }
}

function resolveManagedSubscriptionEndpoint(
  refs: Record<string, Construct>,
  subscription: Extract<SNSSubscriptionConfig, { type: "sqs" | "lambda" }>,
): string {
  const targetRefName = normalizeManagedResourceRef(subscription.target);
  const targetRef = refs[targetRefName];
  if (!targetRef) {
    throw new Error(
      `SNS subscription target "${subscription.target}" could not be resolved.`,
    );
  }

  if (subscription.type === "sqs") {
    if (!("queueArn" in targetRef)) {
      throw new Error(
        `SNS subscription target "${subscription.target}" is not an SQS queue.`,
      );
    }
    return (targetRef as sqs.Queue).queueArn;
  }

  if (!("functionArn" in targetRef)) {
    throw new Error(
      `SNS subscription target "${subscription.target}" is not a Lambda function.`,
    );
  }
  return (targetRef as lambda.Function).functionArn;
}

function resolveManagedLambdaTarget(
  refs: Record<string, Construct>,
  stack: Stack,
  target: string,
): lambda.Function | undefined {
  const targetName = normalizeManagedResourceRef(target);
  const directRef = refs[targetName];
  if (
    directRef &&
    "functionArn" in directRef &&
    "addPermission" in directRef
  ) {
    return directRef as lambda.Function;
  }

  for (const candidate of Object.values(refs)) {
    if (!("functionArn" in candidate) || !("addPermission" in candidate)) {
      continue;
    }
    const logicalId = tryGetLogicalId(stack, candidate);
    if (logicalId === targetName) {
      return candidate as lambda.Function;
    }
  }

  return undefined;
}

export const snsDomain: DomainPlugin = {
  name: "sns",

  synthesize(ctx) {
    const config = ctx.model.domainConfigs.get(SNS_CONFIG);
    if (!config) return;

    for (const [name, topic] of Object.entries(config.topics)) {
      const topicResource = new sns.Topic(ctx.stack, `Topic${name}`, {
        topicName: resolveTopicName(name, ctx.model.provider.stage, topic),
      });
      attachTopicProperties(topicResource, topic);

      ctx.refs[name] = topicResource;
      ctx.availableOutputs.set(`${name}TopicArn`, topicResource.topicArn);
      ctx.availableOutputs.set(`${name}TopicName`, topicResource.topicName);

      for (const [index, subscription] of (topic.subscriptions ?? []).entries()) {
        if (isManagedSubscription(subscription) && subscription.type === "lambda") {
          // Lambda resources are synthesized in the functions domain (later in order),
          // so these are materialized during bind().
          continue;
        }

        const protocol = isManagedSubscription(subscription)
          ? subscription.type
          : subscription.protocol;
        const endpoint = isManagedSubscription(subscription)
          ? resolveManagedSubscriptionEndpoint(ctx.refs, subscription)
          : subscription.endpoint;

        createSubscription(
          ctx.stack,
          `Topic${name}Subscription${index}`,
          topicResource.topicArn,
          protocol,
          endpoint,
          subscription,
        );
      }
    }
  },

  bind(ctx, events) {
    const config = ctx.model.domainConfigs.get(SNS_CONFIG);
    if (!config) return;

    const lambdaSubscriptions = new Set<string>();

    for (const [topicName, topicConfig] of Object.entries(config.topics)) {
      const topicRef = resolveTopicRef(ctx.refs, topicName);
      for (const [index, subscription] of (topicConfig.subscriptions ?? []).entries()) {
        if (!isManagedSubscription(subscription) || subscription.type !== "lambda") {
          continue;
        }
        const functionRef = resolveManagedLambdaTarget(
          ctx.refs,
          ctx.stack,
          subscription.target,
        );
        if (!functionRef) {
          throw new Error(
            `SNS subscription target "${subscription.target}" is not a Lambda function.`,
          );
        }

        const subscriptionKey = `${topicName}|${functionRef.node.path}`;
        if (lambdaSubscriptions.has(subscriptionKey)) continue;

        createSubscription(
          ctx.stack,
          `Topic${topicName}LambdaSubscription${index}`,
          topicRef.topicArn,
          "lambda",
          functionRef.functionArn,
          subscription,
        );

        functionRef.addPermission(
          `AllowSnsInvokeFrom${topicName}${index}`,
          {
            principal: new iam.ServicePrincipal("sns.amazonaws.com"),
            sourceArn: topicRef.topicArn,
          },
        );
        lambdaSubscriptions.add(subscriptionKey);
      }
    }

    for (const [index, event] of events.entries()) {
      if (event.type !== "sns") continue;
      const refName = normalizeManagedResourceRef(event.topic);
      const topic = resolveTopicRef(ctx.refs, refName);

      const subscriptionKey = `${refName}|${event.fnResource.node.path}`;
      if (lambdaSubscriptions.has(subscriptionKey)) continue;

      createSubscription(
        ctx.stack,
        `Topic${refName}EventSubscription${index}`,
        topic.topicArn,
        "lambda",
        event.fnResource.functionArn,
        {},
      );

      event.fnResource.addPermission(`AllowSnsInvokeFrom${refName}Event${index}`, {
        principal: new iam.ServicePrincipal("sns.amazonaws.com"),
        sourceArn: topic.topicArn,
      });
      lambdaSubscriptions.add(subscriptionKey);
    }
  },
};

