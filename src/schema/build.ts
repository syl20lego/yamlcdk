import { z } from "zod";

const esbuildSourcemapSchema = z.union([
  z.boolean(),
  z.enum(["inline", "external", "linked", "both"]),
]);

const esbuildTargetSchema = z.union([
  z.string().min(1),
  z.array(z.string().min(1)).min(1),
]);

const esbuildPlatformSchema = z.enum(["node", "browser", "neutral"]);
const esbuildFormatSchema = z.enum(["cjs", "esm", "iife"]);
const esbuildCharsetSchema = z.enum(["ascii", "utf8"]);
const esbuildLegalCommentsSchema = z.enum([
  "none",
  "inline",
  "eof",
  "linked",
  "external",
]);

export const esbuildOptionsSchema = z.object({
  bundle: z.boolean().optional(),
  minify: z.boolean().optional(),
  minifyWhitespace: z.boolean().optional(),
  minifyIdentifiers: z.boolean().optional(),
  minifySyntax: z.boolean().optional(),
  sourcemap: esbuildSourcemapSchema.optional(),
  target: esbuildTargetSchema.optional(),
  platform: esbuildPlatformSchema.optional(),
  format: esbuildFormatSchema.optional(),
  external: z.array(z.string().min(1)).optional(),
  inject: z.array(z.string().min(1)).optional(),
  define: z.record(z.string(), z.string()).optional(),
  loader: z.record(z.string(), z.string()).optional(),
  keepNames: z.boolean().optional(),
  treeShaking: z.boolean().optional(),
  pure: z.array(z.string().min(1)).optional(),
  ignoreAnnotations: z.boolean().optional(),
  banner: z.record(z.string(), z.string()).optional(),
  footer: z.record(z.string(), z.string()).optional(),
  tsconfig: z.string().min(1).optional(),
  charset: esbuildCharsetSchema.optional(),
  legalComments: esbuildLegalCommentsSchema.optional(),
});

export const buildConfigSchema = z.object({
  mode: z.enum(["typescript", "external", "none", "esbuild"]).optional(),
  command: z.string().min(1).optional(),
  cwd: z.string().min(1).optional(),
  handler: z.string().min(1).optional(),
  esbuild: esbuildOptionsSchema.optional(),
});
