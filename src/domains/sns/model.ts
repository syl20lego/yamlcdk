import { z } from "zod";
import { createDomainConfigKey } from "../../compiler/plugins/domain-configs.js";
import {
  snsSubscriptionSchema as sharedSnsSubscriptionSchema,
  snsTopicSchema as sharedSnsTopicSchema,
} from "../../schema/domain-primitives.js";

export const snsSubscriptionConfigSchema = sharedSnsSubscriptionSchema;

export type SNSSubscriptionConfig = z.infer<typeof snsSubscriptionConfigSchema>;

export const snsTopicConfigSchema = sharedSnsTopicSchema;

export type SNSTopicConfig = z.infer<typeof snsTopicConfigSchema>;

export const snsDomainConfigSchema = z.object({
  topics: z.record(z.string(), snsTopicConfigSchema),
});

export type SNSDomainConfig = z.infer<typeof snsDomainConfigSchema>;

export const SNS_CONFIG = createDomainConfigKey("sns", snsDomainConfigSchema);

