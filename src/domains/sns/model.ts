import { z } from "zod";
import { createDomainConfigKey } from "../../compiler/plugins/domain-configs.js";

const snsSubscriptionCommonSchema = z.object({
  deliveryPolicy: z.record(z.string(), z.unknown()).optional(),
  filterPolicy: z.record(z.string(), z.unknown()).optional(),
  filterPolicyScope: z.enum(["MessageAttributes", "MessageBody"]).optional(),
  rawMessageDelivery: z.boolean().optional(),
  redrivePolicy: z.record(z.string(), z.unknown()).optional(),
  region: z.string().min(1).optional(),
  replayPolicy: z
    .union([z.record(z.string(), z.unknown()), z.string().min(1)])
    .optional(),
  subscriptionRoleArn: z.string().min(1).optional(),
});

export const snsManagedSubscriptionSchema = snsSubscriptionCommonSchema.extend({
  type: z.enum(["sqs", "lambda"]),
  target: z.string().min(1),
});

export const snsDirectSubscriptionSchema = snsSubscriptionCommonSchema.extend({
  protocol: z.string().min(1),
  endpoint: z.string().min(1),
});

export const snsSubscriptionConfigSchema = z.union([
  snsManagedSubscriptionSchema,
  snsDirectSubscriptionSchema,
]);

export type SNSSubscriptionConfig = z.infer<typeof snsSubscriptionConfigSchema>;

export const snsTopicLoggingConfigSchema = z.object({
  protocol: z.string().min(1),
  failureFeedbackRoleArn: z.string().min(1).optional(),
  successFeedbackRoleArn: z.string().min(1).optional(),
  successFeedbackSampleRate: z.string().min(1).optional(),
});

export const snsTopicConfigSchema = z.object({
  topicName: z.string().min(1).optional(),
  displayName: z.string().min(1).optional(),
  fifoTopic: z.boolean().optional(),
  contentBasedDeduplication: z.boolean().optional(),
  fifoThroughputScope: z.enum(["Topic", "MessageGroup"]).optional(),
  kmsMasterKeyId: z.string().min(1).optional(),
  signatureVersion: z.string().min(1).optional(),
  tracingConfig: z.enum(["PassThrough", "Active"]).optional(),
  archivePolicy: z.record(z.string(), z.unknown()).optional(),
  dataProtectionPolicy: z
    .union([z.record(z.string(), z.unknown()), z.string().min(1)])
    .optional(),
  deliveryStatusLogging: z.array(snsTopicLoggingConfigSchema).optional(),
  tags: z.record(z.string(), z.string()).optional(),
  subscriptions: z.array(snsSubscriptionConfigSchema).optional(),
});

export type SNSTopicConfig = z.infer<typeof snsTopicConfigSchema>;

export const snsYamlcdkMessagingSchema = z.record(z.string(), snsTopicConfigSchema);

export const snsDomainConfigSchema = z.object({
  topics: snsYamlcdkMessagingSchema,
});

export type SNSDomainConfig = z.infer<typeof snsDomainConfigSchema>;

export const SNS_CONFIG = createDomainConfigKey("sns", snsDomainConfigSchema);
