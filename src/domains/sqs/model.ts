import { z } from "zod";
import { createDomainConfigKey } from "../../compiler/plugins/domain-configs.js";
export const sqsQueueConfigSchema = z.object({
  visibilityTimeout: z.number().int().min(0).max(43200).optional(),
});

export type SQSQueueConfig = z.infer<typeof sqsQueueConfigSchema>;

export const sqsYamlcdkMessagingSchema = z.record(z.string(), sqsQueueConfigSchema);

export const sqsDomainConfigSchema = z.object({
  queues: sqsYamlcdkMessagingSchema,
});

export type SQSDomainConfig = z.infer<typeof sqsDomainConfigSchema>;

export const SQS_CONFIG = createDomainConfigKey("sqs", sqsDomainConfigSchema);
