export type EsbuildSourcemapOption =
  | boolean
  | "inline"
  | "external"
  | "linked"
  | "both";

export type EsbuildTargetOption = string | readonly string[];

export interface EsbuildBuildConfig {
  readonly bundle?: boolean;
  readonly minify?: boolean;
  readonly minifyWhitespace?: boolean;
  readonly minifyIdentifiers?: boolean;
  readonly minifySyntax?: boolean;
  readonly sourcemap?: EsbuildSourcemapOption;
  readonly target?: EsbuildTargetOption;
  readonly platform?: "node" | "browser" | "neutral";
  readonly format?: "cjs" | "esm" | "iife";
  readonly external?: readonly string[];
  readonly inject?: readonly string[];
  readonly define?: Readonly<Record<string, string>>;
  readonly loader?: Readonly<Record<string, string>>;
  readonly keepNames?: boolean;
  readonly treeShaking?: boolean;
  readonly pure?: readonly string[];
  readonly ignoreAnnotations?: boolean;
  readonly banner?: Readonly<Record<string, string>>;
  readonly footer?: Readonly<Record<string, string>>;
  readonly tsconfig?: string;
  readonly charset?: "ascii" | "utf8";
  readonly legalComments?: "none" | "inline" | "eof" | "linked" | "external";
}

export interface BuildableFunctionConfig {
  readonly handler: string;
  readonly runtime?: string;
  readonly build?: {
    readonly mode?: string;
    readonly command?: string;
    readonly cwd?: string;
    readonly handler?: string;
    readonly esbuild?: EsbuildBuildConfig;
  };
}

/** Minimal config shape needed for function builds. */
export interface BuildableConfig {
  readonly functions: Readonly<Record<string, BuildableFunctionConfig>>;
}

export interface BuildResult {
  assetPath: string;
  handler: string;
  /** When set, use Code.fromInline() instead of Code.fromAsset(). */
  inline?: string;
}

export interface BuildRequest {
  readonly functionName: string;
  readonly fn: BuildableFunctionConfig;
}

export interface BuildProviderContext {
  readonly cwd: string;
}

export interface BuildProvider {
  readonly mode: string;
  build(request: BuildRequest, context: BuildProviderContext): BuildResult;
}

export interface BuildProviderStub {
  readonly mode: string;
  readonly summary: string;
  readonly notes?: string;
}

export type ActiveBuildMode = "typescript" | "esbuild" | "external" | "none";
