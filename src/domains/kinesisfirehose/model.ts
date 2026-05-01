import { z } from "zod";
import { createDomainConfigKey } from "../../compiler/plugins/domain-configs.js";

const cfnIntrinsicSchema = z.record(z.string(), z.unknown());
const tokenStringSchema = z.union([z.string().min(1), cfnIntrinsicSchema]);

export type FirehoseTokenString = z.infer<typeof tokenStringSchema>;

const firehoseCfnPropertiesSchema = z.record(z.string(), z.unknown());

export const firehoseDeliveryStreamConfigSchema = z.object({
  name: tokenStringSchema.optional(),
  type: z.string().min(1).optional(),
  properties: firehoseCfnPropertiesSchema.default({}),
});

export type FirehoseDeliveryStreamConfig = z.infer<
  typeof firehoseDeliveryStreamConfigSchema
>;

export const kinesisFirehoseDomainConfigSchema = z.object({
  streams: z.record(z.string(), firehoseDeliveryStreamConfigSchema).default({}),
  helperDefaults: z.boolean().default(false),
});

export type KinesisFirehoseDomainConfig = z.infer<
  typeof kinesisFirehoseDomainConfigSchema
>;

export const firehoseYamlcdkMessagingSchema = kinesisFirehoseDomainConfigSchema;

export const KINESIS_FIREHOSE_CONFIG = createDomainConfigKey(
  "kinesisfirehose",
  kinesisFirehoseDomainConfigSchema,
);
