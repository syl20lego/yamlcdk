import { describe, expect, test } from "vitest";
import {
  detectCloudFormationFailureState,
  isSuccessfulDeployStackStatus,
  selectLatestFailureReason,
} from "../cdk.js";

describe("runtime cdk", () => {
  test("detects rollback in-progress state messages", () => {
    const output =
      "The resource sls-consumer-profile-v1-slegault is in a ROLLBACK_IN_PROGRESS state";

    expect(detectCloudFormationFailureState(output)).toBe("ROLLBACK_IN_PROGRESS");
  });

  test("detects failed stack states from deploy output", () => {
    const output = "Stack deployment failed: UPDATE_ROLLBACK_COMPLETE";

    expect(detectCloudFormationFailureState(output)).toBe("UPDATE_ROLLBACK_COMPLETE");
  });

  test("ignores non-failure output", () => {
    const output = "Stack arn:aws:cloudformation:... updated successfully";

    expect(detectCloudFormationFailureState(output)).toBeUndefined();
  });

  test("accepts only deploy-success stack statuses", () => {
    expect(isSuccessfulDeployStackStatus("CREATE_COMPLETE")).toBe(true);
    expect(isSuccessfulDeployStackStatus("UPDATE_COMPLETE")).toBe(true);
    expect(isSuccessfulDeployStackStatus("IMPORT_COMPLETE")).toBe(true);
    expect(isSuccessfulDeployStackStatus("ROLLBACK_COMPLETE")).toBe(false);
    expect(isSuccessfulDeployStackStatus("CREATE_IN_PROGRESS")).toBe(false);
  });

  test("extracts latest failure reason from stack events", () => {
    const reason = selectLatestFailureReason([
      {
        ResourceStatus: "ROLLBACK_IN_PROGRESS",
        ResourceStatusReason:
          "No export named consumer-search-oss-v1-slegault-endpoint found. Rollback requested by user.",
      },
      {
        ResourceStatus: "CREATE_IN_PROGRESS",
        ResourceStatusReason: "User Initiated",
      },
    ]);

    expect(reason).toBe(
      "No export named consumer-search-oss-v1-slegault-endpoint found. Rollback requested by user.",
    );
  });

  test("returns undefined when no failure reason exists in events", () => {
    const reason = selectLatestFailureReason([
      { ResourceStatus: "CREATE_IN_PROGRESS", ResourceStatusReason: "User Initiated" },
      { ResourceStatus: "REVIEW_IN_PROGRESS" },
    ]);

    expect(reason).toBeUndefined();
  });
});
