import { z } from "zod";

export const buildConfigSchema = z.object({
  mode: z.enum(["typescript", "external", "none"]).optional(),
  command: z.string().min(1).optional(),
  cwd: z.string().min(1).optional(),
  handler: z.string().min(1).optional(),
});
