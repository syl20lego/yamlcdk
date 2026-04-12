import { z } from "zod";

export const functionUrlAuthTypeSchema = z.enum(["AWS_IAM", "NONE"]);

export const functionUrlInvokeModeSchema = z.enum([
  "BUFFERED",
  "RESPONSE_STREAM",
]);

export const functionUrlHttpMethodSchema = z.enum([
  "GET",
  "PUT",
  "HEAD",
  "POST",
  "DELETE",
  "PATCH",
  "OPTIONS",
  "*",
]);

export const functionUrlCorsSchema = z.object({
  allowCredentials: z.boolean().optional(),
  allowHeaders: z.array(z.string().min(1)).optional(),
  allowedMethods: z.array(functionUrlHttpMethodSchema).optional(),
  allowOrigins: z.array(z.string().min(1)).optional(),
  exposeHeaders: z.array(z.string().min(1)).optional(),
  maxAge: z.number().int().min(0).optional(),
});
