// @vitest-environment node
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

describe("Tauri capabilities", () => {
  it("allows the main window to subscribe to backend event streams", () => {
    const raw = readFileSync("src-tauri/capabilities/default.json", "utf8");
    const capability = JSON.parse(raw) as { windows?: string[]; permissions?: string[] };

    expect(capability.windows).toContain("main");
    expect(capability.permissions).toContain("core:default");
    expect(capability.permissions).toContain("core:event:default");
  });
});
