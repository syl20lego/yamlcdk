import { z } from "zod";
import { createDomainConfigKey } from "../../compiler/plugins/index.js";

export const apisDomainConfigSchema = z.object({
  restApi: z
    .object({
      cloudWatchRoleArn: z.string().min(1).optional(),
    })
    .optional(),
});

export type ApisDomainConfig = z.infer<typeof apisDomainConfigSchema>;

export const APIS_CONFIG = createDomainConfigKey(
  "apis",
  apisDomainConfigSchema,
);

