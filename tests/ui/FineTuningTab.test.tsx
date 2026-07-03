import { describe, it, expect } from "vitest";
import { screen } from "@testing-library/react";
import { FineTuningTab } from "@/ui/tabs/FineTuningTab";
import { renderApp } from "./helpers";

describe("FineTuningTab", () => {
  it("exposes dataset, output, learning rate, epochs, batch size, and start/stop", async () => {
    const { controller } = await renderApp(<FineTuningTab />);
    expect(screen.getByTestId("finetune-train-data")).toBeDefined();
    expect(screen.getByTestId("finetune-lora-out")).toBeDefined();
    expect(screen.getByTestId("flag-learning-rate")).toBeDefined();
    expect(screen.getByTestId("flag-epochs")).toBeDefined();
    expect(screen.getByTestId("flag-batch-size")).toBeDefined();
    expect(screen.getByTestId("start-training")).toBeDefined();
    expect(screen.getByTestId("stop-training")).toBeDefined();
    controller.dispose();
  });

  it("disables Stop when training is not running and Start when it is", async () => {
    const { controller, emit } = await renderApp(<FineTuningTab />);
    expect((screen.getByTestId("start-training") as HTMLButtonElement).disabled).toBe(false);
    expect((screen.getByTestId("stop-training") as HTMLButtonElement).disabled).toBe(true);
    emit("status", { kind: "finetune", state: "running", pid: 9, startedAt: Date.now() });
    await new Promise((r) => setTimeout(r, 10));
    expect((screen.getByTestId("start-training") as HTMLButtonElement).disabled).toBe(true);
    expect((screen.getByTestId("stop-training") as HTMLButtonElement).disabled).toBe(false);
    controller.dispose();
  });
});
