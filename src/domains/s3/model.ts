import { z } from "zod";
import { createDomainConfigKey } from "../../compiler/plugins/domain-configs.js";
import { s3BucketSchema as sharedS3BucketSchema } from "../../schema/domain-primitives.js";

export const s3BucketConfigSchema = sharedS3BucketSchema;

export type S3BucketConfig = z.infer<typeof s3BucketConfigSchema>;

export const s3DomainConfigSchema = z.object({
  buckets: z.record(z.string(), s3BucketConfigSchema),
  cleanupRoleArn: z.string().min(1).optional(),
});

export type S3DomainConfig = z.infer<typeof s3DomainConfigSchema>;

export const S3_CONFIG = createDomainConfigKey("s3", s3DomainConfigSchema);

