import { z } from "zod";

export const deploymentConfigSchema = z.object({
  fileAssetsBucketName: z.string().min(1).optional(),
  imageAssetsRepositoryName: z.string().min(1).optional(),
  cloudFormationServiceRoleArn: z.string().min(1).optional(),
  cloudFormationExecutionRoleArn: z.string().min(1).optional(),
  deployRoleArn: z.string().min(1).optional(),
  qualifier: z.string().min(1).optional(),
  useCliCredentials: z.boolean().optional(),
  requireBootstrap: z.boolean().optional(),
});
