// @vitest-environment jsdom
import { beforeEach, describe, expect, it, vi } from "vitest";

const listenMock = vi.fn();
const invokeMock = vi.fn();

vi.mock("@tauri-apps/api/event", () => ({
  listen: (...args: unknown[]) => listenMock(...args),
}));

vi.mock("@tauri-apps/api/core", () => ({
  invoke: (...args: unknown[]) => invokeMock(...args),
}));

describe("Tauri transport", () => {
  beforeEach(() => {
    listenMock.mockReset();
    invokeMock.mockReset();
    Object.defineProperty(window, "__TAURI_INTERNALS__", { value: {}, configurable: true });
  });

  it("surfaces event ACL failures through the error listener", async () => {
    const { createTauriTransport } = await import("@/ipc/transport");
    listenMock.mockRejectedValue(new Error("Command plugin:event|listen not allowed by ACL"));
    const transport = createTauriTransport();
    const errors: unknown[] = [];

    transport.on("error", (payload) => errors.push(payload));
    await new Promise((resolve) => setTimeout(resolve, 0));

    expect(errors).toHaveLength(1);
    expect(String((errors[0] as { title: string }).title)).toMatch(/event channel/i);
    expect(String((errors[0] as { message: string }).message)).toContain("plugin:event|listen");
  });
});
