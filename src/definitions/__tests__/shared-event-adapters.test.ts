import { describe, expect, test } from "vitest";
import type { EventDeclaration } from "../../compiler/model.js";
import {
  appendUniqueEvent,
  createEventBridgeEvent,
  createHttpEvent,
  createRestEvent,
} from "../shared-event-adapters.js";

describe("shared event adapters", () => {
  test("normalizes HTTP/REST route shape", () => {
    expect(createHttpEvent("get", "hello")).toEqual({
      type: "http",
      method: "GET",
      path: "/hello",
    });

    expect(createRestEvent("post", "items", true)).toEqual({
      type: "rest",
      method: "POST",
      path: "/items",
      apiKeyRequired: true,
    });
  });

  test("deduplicates canonical events", () => {
    const events: EventDeclaration[] = [];
    const event = createHttpEvent("GET", "/hello");
    appendUniqueEvent(events, event);
    appendUniqueEvent(events, event);
    expect(events).toHaveLength(1);
  });

  test("throws actionable message for invalid eventbridge event", () => {
    expect(() =>
      createEventBridgeEvent(
        {},
        'CloudFormation EventBridge rule "MyRule" must define ScheduleExpression or EventPattern.',
      ),
    ).toThrow(
      'CloudFormation EventBridge rule "MyRule" must define ScheduleExpression or EventPattern.',
    );
  });
});
