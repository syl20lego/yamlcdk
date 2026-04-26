import type {
  EventBusReference,
  EventDeclaration,
} from "../compiler/model.js";

export function ensureLeadingSlash(pathValue: string): string {
  if (pathValue === "*") return pathValue;
  return pathValue.startsWith("/") ? pathValue : `/${pathValue}`;
}

export function appendUniqueEvent(
  events: EventDeclaration[],
  event: EventDeclaration,
): void {
  const serialized = JSON.stringify(event);
  if (!events.some((entry) => JSON.stringify(entry) === serialized)) {
    events.push(event);
  }
}

export function createHttpEvent(
  method: string,
  path: string,
): EventDeclaration {
  return {
    type: "http",
    method: method.toUpperCase(),
    path: ensureLeadingSlash(path),
  };
}

export function createRestEvent(
  method: string,
  path: string,
  apiKeyRequired: boolean,
): EventDeclaration {
  return {
    type: "rest",
    method: method.toUpperCase(),
    path: ensureLeadingSlash(path),
    apiKeyRequired,
  };
}

export function createS3Event(
  bucket: string,
  events: string[],
): EventDeclaration {
  return { type: "s3", bucket, events };
}

export function createSqsEvent(
  queue: string,
  batchSize?: number,
): EventDeclaration {
  return { type: "sqs", queue, batchSize };
}

export function createSnsEvent(topic: string): EventDeclaration {
  return { type: "sns", topic };
}

export function createDynamodbStreamEvent(
  table: string,
  batchSize?: number,
  startingPosition?: string,
): EventDeclaration {
  return { type: "dynamodb-stream", table, batchSize, startingPosition };
}

export function createEventBridgeEvent(
  input: {
    schedule?: string;
    eventPattern?: Record<string, unknown>;
    eventBus?: EventBusReference;
  },
  missingMessage = 'EventBridge event must define at least one of "schedule" or "eventPattern".',
): EventDeclaration {
  if (!input.schedule && !input.eventPattern) {
    throw new Error(missingMessage);
  }
  return {
    type: "eventbridge",
    schedule: input.schedule,
    eventPattern: input.eventPattern,
    eventBus: input.eventBus,
  };
}
