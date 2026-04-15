/**
 * Zod schemas and TypeScript types for CloudFormation intrinsic
 * function values that may appear as Lambda environment variable values.
 *
 * Supported intrinsics: Ref, Fn::GetAtt, Fn::Sub, Fn::Join.
 */

import { z } from "zod";

// ─── Individual intrinsic schemas ───────────────────────────

export const cfnRefEnvSchema = z.object({ Ref: z.string().min(1) });

export const cfnGetAttEnvSchema = z.object({
  "Fn::GetAtt": z.tuple([z.string().min(1), z.string().min(1)]),
});

export const cfnSubEnvSchema = z.object({
  "Fn::Sub": z.union([
    z.string().min(1),
    z.tuple([z.string().min(1), z.record(z.string(), z.unknown())]),
  ]),
});

export const cfnJoinEnvSchema = z.object({
  "Fn::Join": z.tuple([z.string(), z.array(z.unknown()).min(1)]),
});

// ─── Union of all supported intrinsics ──────────────────────

export const cfnIntrinsicEnvSchema = z.union([
  cfnRefEnvSchema,
  cfnGetAttEnvSchema,
  cfnSubEnvSchema,
  cfnJoinEnvSchema,
]);

export type CfnIntrinsicEnv = z.infer<typeof cfnIntrinsicEnvSchema>;

// ─── Environment value: scalar string or intrinsic ──────────

export const envValueSchema = z.union([z.string(), cfnIntrinsicEnvSchema]);

export type EnvValue = z.infer<typeof envValueSchema>;

// ─── Type guards ────────────────────────────────────────────

export function isCfnIntrinsicEnv(value: unknown): value is CfnIntrinsicEnv {
  return cfnIntrinsicEnvSchema.safeParse(value).success;
}
