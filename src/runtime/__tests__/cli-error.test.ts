import { describe, expect, test } from "vitest";
import { formatCliError } from "../cli-error.js";

describe("formatCliError", () => {
  test("formats regular Error messages", () => {
    expect(formatCliError(new Error("boom"))).toBe("boom");
  });

  test("formats cause chains when top-level message is empty", () => {
    const error = new Error("", { cause: new Error("inner failure") });
    expect(formatCliError(error)).toBe("Error\nCaused by: inner failure");
  });

  test("formats non-Error values", () => {
    expect(formatCliError("plain failure")).toBe("plain failure");
  });

  test("formats AggregateError nested messages", () => {
    const error = new AggregateError([new Error("first"), new Error("second")], "");
    expect(formatCliError(error)).toContain("AggregateError");
    expect(formatCliError(error)).toContain("Caused by: first");
    expect(formatCliError(error)).toContain("Caused by: second");
  });
});
