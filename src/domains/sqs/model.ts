import { z } from "zod";
import { createDomainConfigKey } from "../../compiler/plugins/domain-configs.js";
import { sqsQueueSchema as sharedSqsQueueSchema } from "../../schema/domain-primitives.js";

export const sqsQueueConfigSchema = sharedSqsQueueSchema;

export type SQSQueueConfig = z.infer<typeof sqsQueueConfigSchema>;

export const sqsDomainConfigSchema = z.object({
  queues: z.record(z.string(), sqsQueueConfigSchema),
});

export type SQSDomainConfig = z.infer<typeof sqsDomainConfigSchema>;

export const SQS_CONFIG = createDomainConfigKey("sqs", sqsDomainConfigSchema);

