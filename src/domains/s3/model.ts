import { z } from "zod";
import { createDomainConfigKey } from "../../compiler/plugins/domain-configs.js";
export const s3BucketConfigSchema = z.object({
  versioned: z.boolean().optional(),
  autoDeleteObjects: z.boolean().optional(),
});

export type S3BucketConfig = z.infer<typeof s3BucketConfigSchema>;

export const s3YamlcdkStorageSchema = z.record(z.string(), s3BucketConfigSchema);

export const s3DomainConfigSchema = z.object({
  buckets: s3YamlcdkStorageSchema,
  cleanupRoleArn: z.string().min(1).optional(),
});

export type S3DomainConfig = z.infer<typeof s3DomainConfigSchema>;

export const S3_CONFIG = createDomainConfigKey("s3", s3DomainConfigSchema);
