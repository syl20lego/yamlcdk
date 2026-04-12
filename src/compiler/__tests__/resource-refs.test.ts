import { describe, expect, test } from "vitest";
import {
  normalizeManagedResourceRef,
  resolveManagedResourceRef,
} from "../resource-refs.js";

describe("managed resource refs", () => {
  test("normalizes ref-prefixed values", () => {
    expect(normalizeManagedResourceRef("ref:users")).toBe("users");
  });

  test("keeps bare names unchanged", () => {
    expect(normalizeManagedResourceRef("users")).toBe("users");
  });

  test("rejects empty ref-prefixed values", () => {
    expect(() => normalizeManagedResourceRef("ref:")).toThrow(
      "Invalid managed resource reference",
    );
  });

  test("resolves explicit ref-prefixed values", () => {
    expect(resolveManagedResourceRef("ref:users", {})).toBe("users");
  });

  test("resolves bare names when they exist in managed refs", () => {
    expect(resolveManagedResourceRef("users", { users: {} })).toBe("users");
  });

  test("does not treat unknown bare names as managed refs", () => {
    expect(resolveManagedResourceRef("users", {})).toBeUndefined();
  });
});

