/**
 * Domain plugin contract and compilation context types.
 *
 * A domain plugin owns a slice of AWS infrastructure
 * (S3, DynamoDB, Lambda, API Gateway, …).  It participates
 * in the compiler lifecycle through strongly typed hooks.
 */

import type cdk from "aws-cdk-lib";
import type * as lambda from "aws-cdk-lib/aws-lambda";
import type { Construct } from "constructs";
import type { ServiceModel, EventDeclaration } from "../model.js";

// ─── Shared resource refs ───────────────────────────────────

/** Map of logical resource names to CDK constructs, shared across domains. */
export type ResourceRefs = Record<string, Construct>;

// ─── Event binding (synthesis-level) ────────────────────────

/**
 * CDK-level event binding produced during synthesis.
 *
 * Extends the model-level {@link EventDeclaration} with the
 * concrete Lambda Function construct so binding domains can
 * wire event sources without knowing which function definition
 * format produced the declaration.
 */
export type EventBinding = {
  readonly functionName: string;
  readonly fnResource: lambda.Function;
} & EventDeclaration;

// ─── Compilation context ────────────────────────────────────

/**
 * Context passed to every domain plugin lifecycle hook.
 *
 * Domains read the full service model, access domain-specific
 * config through `model.domainConfigs`, and write to the shared
 * `refs` map during synthesis.  Event bindings are passed
 * separately to the `bind` hook.
 */
export interface CompilationContext {
  readonly stack: cdk.Stack;
  readonly model: ServiceModel;
  readonly refs: ResourceRefs;
}

// ─── Synthesis result ───────────────────────────────────────

/**
 * Optional return value from {@link DomainPlugin.synthesize}.
 *
 * Domains that create event sources (e.g. the functions domain)
 * return bindings here.  The compiler collects them and passes
 * the aggregate to every domain's `bind` hook.
 */
export interface SynthesisResult {
  readonly events?: readonly EventBinding[];
}

// ─── Domain plugin interface ────────────────────────────────

/**
 * Contract for a domain plugin.
 *
 * All lifecycle hooks are optional — a plugin implements only
 * the phases it participates in.
 *
 * Lifecycle order (enforced by the compiler pipeline):
 *
 *  1. **validate** — check domain config for consistency.
 *  2. **synthesize** — create CDK constructs, register refs,
 *     optionally return event bindings.
 *  3. **bind** — wire event sources to targets using the
 *     aggregated event bindings from all domains.
 *  4. **finalize** — emit CfnOutputs or perform cleanup.
 */
export interface DomainPlugin {
  /** Unique domain name (e.g. `"s3"`, `"functions"`). */
  readonly name: string;

  /**
   * Validate domain-specific configuration before synthesis.
   * Throw on invalid state.
   */
  validate?(ctx: CompilationContext): void;

  /**
   * Create CDK constructs.  Register them in `ctx.refs` so
   * other domains can reference them during binding.
   *
   * Return event bindings if this domain produces them.
   */
  synthesize?(ctx: CompilationContext): SynthesisResult | void;

  /**
   * Wire event sources to Lambda targets.  `events` contains
   * the aggregated bindings from all domains' synthesis phase.
   */
  bind?(ctx: CompilationContext, events: readonly EventBinding[]): void;

  /**
   * Emit CfnOutputs or perform post-binding cleanup.
   */
  finalize?(ctx: CompilationContext): void;
}
