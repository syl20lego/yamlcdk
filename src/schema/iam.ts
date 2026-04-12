import { z } from "zod";

export const iamEffectSchema = z.enum(["Allow", "Deny"]);

export const iamStatementSchema = z.object({
  sid: z.string().optional(),
  effect: iamEffectSchema.optional(),
  actions: z.array(z.string()).min(1),
  resources: z.array(z.string()).min(1),
});
