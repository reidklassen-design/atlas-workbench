import { describe, it, expect } from "vitest";
import { screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { Shell } from "@/ui/App";
import { renderApp, baselineConfig, baselineHandlers } from "./helpers";

describe("App shell", () => {
  it("renders all tabs and switches between them", async () => {
    const { controller } = await renderApp(<Shell />);
    expect(screen.getByTestId("tab-server")).toBeDefined();
    expect(screen.getByTestId("tab-models")).toBeDefined();
    expect(screen.getByTestId("tab-settings")).toBeDefined();
    expect(screen.getByTestId("tab-fine-tuning")).toBeDefined();
    expect(screen.getByTestId("tab-system-monitor")).toBeDefined();
    expect(screen.getByTestId("tab-agent-runtime")).toBeDefined();

    await userEvent.click(screen.getByTestId("tab-system-monitor"));
    expect(screen.getByTestId("gpu-not-detected")).toBeDefined();

    await userEvent.click(screen.getByTestId("tab-settings"));
    expect(screen.getByTestId("binary-settings-section")).toBeDefined();

    await userEvent.click(screen.getByTestId("tab-agent-runtime"));
    expect(screen.getByTestId("snippet-opencode")).toBeDefined();
    expect(screen.getByTestId("snippet-codex")).toBeDefined();
    controller.dispose();
  });

  it("shows the first-launch binary prompt when no server binary is configured", async () => {
    const handlers = baselineHandlers({}, () => baselineConfig({ binaryPaths: { server: "", finetune: "" } }));
    const { controller } = await renderApp(<Shell />, handlers);
    expect(screen.getByTestId("binary-setup-dialog")).toBeDefined();
    controller.dispose();
  });

  it("lets the user save binary paths from the first-launch dialog", async () => {
    const saved: { server: string; finetune: string }[] = [];
    const handlers = baselineHandlers({
      "binary.set": (args) => {
        saved.push({ server: String(args.server), finetune: String(args.finetune) });
        return baselineConfig({ binaryPaths: { server: String(args.server), finetune: String(args.finetune) } });
      },
    }, () => baselineConfig({ binaryPaths: { server: "", finetune: "" } }));
    const { controller } = await renderApp(<Shell />, handlers);

    const serverInput = screen.getByTestId("server-binary");
    await userEvent.type(serverInput, "/usr/bin/llama-server");
    await userEvent.click(screen.getByTestId("binary-setup-save"));

    expect(saved[0]?.server).toBe("/usr/bin/llama-server");
    controller.dispose();
  });

  it("does not re-prompt when valid binary paths are already saved", async () => {
    const { controller } = await renderApp(<Shell />);
    expect(screen.queryByTestId("binary-setup-dialog")).toBeNull();
    controller.dispose();
  });

  it("does not render top-level notification or error banners", async () => {
    const { controller, emit } = await renderApp(<Shell />);
    emit("notice", { id: "n1", title: "Binary paths saved", message: "Server path saved.", ts: Date.now() });
    emit("training-complete", { outputPath: "/out/trained.bin", exists: true, exitCode: 0 });
    emit("error", { id: "e1", scope: "server-control", title: "Server stopped unexpectedly", message: "The server exited.", fix: "Review the log.", ts: Date.now() });
    await new Promise((r) => setTimeout(r, 10));

    expect(screen.queryByText(/Binary paths saved/)).toBeNull();
    expect(screen.queryByText(/Server path saved/)).toBeNull();
    expect(screen.queryByRole("alert")).toBeNull();
    expect(screen.getByText(/Server stopped unexpectedly/)).toBeDefined();
    controller.dispose();
  });
});
