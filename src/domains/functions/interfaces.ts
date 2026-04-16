import type * as lambda from "aws-cdk-lib/aws-lambda";
import type { EventDeclaration } from "../../compiler/model.js";

/**
 * Explicit cross-domain handoff payload produced by the functions domain.
 *
 * Binding domains (API Gateway, EventBridge, S3, SQS, SNS, DynamoDB stream
 * integrations) consume this shape to wire event sources to Lambda functions.
 */
export type FunctionEventBinding = {
  readonly functionName: string;
  readonly fnResource: lambda.Function;
} & EventDeclaration;

