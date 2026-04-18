import { Match } from "aws-cdk-lib/assertions";
import { describe, test } from "vitest";
import { functionConfig, synthServiceConfig } from "./helpers.js";

describe("sns domain e2e", () => {
  test("creates a topic without subscriptions by default", () => {
    const { template } = synthServiceConfig({
      messaging: {
        sns: { alerts: {} },
      },
    });

    template.resourceCountIs("AWS::SNS::Topic", 1);
    template.resourceCountIs("AWS::SNS::Subscription", 0);
  });

  test("creates an sns to sqs subscription when configured", () => {
    const { template } = synthServiceConfig({
      messaging: {
        sqs: { jobs: {} },
        sns: {
          alerts: {
            subscriptions: [{ type: "sqs", target: "jobs" }],
          },
        },
      },
    });

    template.hasResourceProperties(
      "AWS::SNS::Subscription",
      Match.objectLike({
        Protocol: "sqs",
      }),
    );
  });

  test("creates an sns lambda subscription for an sns function event", () => {
    const { template } = synthServiceConfig({
      functions: {
        processor: functionConfig({
          events: {
            sns: [{ topic: "ref:alerts" }],
          },
        }),
      },
      messaging: {
        sns: { alerts: {} },
      },
    });

    template.hasResourceProperties(
      "AWS::SNS::Subscription",
      Match.objectLike({
        Protocol: "lambda",
        }),
      );
  });

  test("applies extended topic properties", () => {
    const { template } = synthServiceConfig({
      messaging: {
        sns: {
          alerts: {
            topicName: "alerts-topic.fifo",
            displayName: "Alerts",
            fifoTopic: true,
            contentBasedDeduplication: true,
            fifoThroughputScope: "MessageGroup",
            kmsMasterKeyId: "alias/aws/sns",
            signatureVersion: "2",
            tracingConfig: "Active",
            archivePolicy: { MessageRetentionPeriod: "7" },
            dataProtectionPolicy: { Name: "alerts-policy" },
            deliveryStatusLogging: [
              {
                protocol: "lambda",
                successFeedbackSampleRate: "100",
              },
            ],
            tags: {
              Team: "platform",
            },
          },
        },
      },
    });

    template.hasResourceProperties(
      "AWS::SNS::Topic",
      Match.objectLike({
        TopicName: "alerts-topic.fifo",
        DisplayName: "Alerts",
        FifoTopic: true,
        ContentBasedDeduplication: true,
        FifoThroughputScope: "MessageGroup",
        KmsMasterKeyId: "alias/aws/sns",
        SignatureVersion: "2",
        TracingConfig: "Active",
        ArchivePolicy: {
          MessageRetentionPeriod: "7",
        },
        DataProtectionPolicy: {
          Name: "alerts-policy",
        },
        DeliveryStatusLogging: Match.arrayWith([
          Match.objectLike({
            Protocol: "lambda",
            SuccessFeedbackSampleRate: "100",
          }),
        ]),
      }),
    );
  });

  test("uses lambda subscription config once when a matching sns event also exists", () => {
    const { template } = synthServiceConfig({
      functions: {
        processor: functionConfig({
          events: {
            sns: [{ topic: "ref:alerts" }],
          },
        }),
      },
      messaging: {
        sns: {
          alerts: {
            subscriptions: [
              {
                type: "lambda",
                target: "processor",
                filterPolicy: {
                  severity: ["high"],
                },
                rawMessageDelivery: true,
              },
            ],
          },
        },
      },
    });

    template.resourceCountIs("AWS::SNS::Subscription", 1);
    template.hasResourceProperties(
      "AWS::SNS::Subscription",
      Match.objectLike({
        Protocol: "lambda",
        FilterPolicy: {
          severity: ["high"],
        },
        RawMessageDelivery: true,
      }),
    );
  });
});
