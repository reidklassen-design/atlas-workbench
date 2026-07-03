import { describe, it, expect } from "vitest";
import { screen, fireEvent } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { ModelsTab } from "@/ui/tabs/ModelsTab";
import { renderApp, baselineHandlers, baselineConfig } from "./helpers";
import type { AppConfig } from "@/config/types";

describe("ModelsTab", () => {
  it("lists .gguf files after browsing to a directory", async () => {
    const handlers = baselineHandlers({
      "model.list": () => ({ directory: "/models", files: ["alpha.gguf", "beta.gguf"] }),
    });
    const { controller } = await renderApp(<ModelsTab />, handlers);
    fireEvent.change(screen.getByTestId("model-directory"), { target: { value: "/models" } });
    await new Promise((r) => setTimeout(r, 20));
    expect(screen.getByTestId("model-list").textContent).toMatch(/alpha.gguf/);
    expect(screen.getByTestId("model-list").textContent).toMatch(/beta.gguf/);
    controller.dispose();
  });

  it("shows a message for an empty directory", async () => {
    const handlers = baselineHandlers({
      "model.list": () => ({ directory: "/empty", files: [], message: "No .gguf files were found in “/empty”." }),
    });
    const { controller } = await renderApp(<ModelsTab />, handlers);
    fireEvent.change(screen.getByTestId("model-directory"), { target: { value: "/empty" } });
    await new Promise((r) => setTimeout(r, 20));
    expect(screen.getByTestId("model-list-empty").textContent).toMatch(/no .gguf files/i);
    controller.dispose();
  });

  it("shows a clear error for a nonexistent directory", async () => {
    const handlers = baselineHandlers({
      "model.list": () => ({ directory: "/nope", files: [], error: "The directory “/nope” could not be read." }),
    });
    const { controller } = await renderApp(<ModelsTab />, handlers);
    fireEvent.change(screen.getByTestId("model-directory"), { target: { value: "/nope" } });
    await new Promise((r) => setTimeout(r, 20));
    expect(screen.getByTestId("model-list-error").textContent).toMatch(/could not be read/i);
    controller.dispose();
  });

  it("selecting a model and clicking Load sets it as active and shows the loaded indicator", async () => {
    const saved: AppConfig[] = [];
    const handlers = baselineHandlers({
      "model.list": () => ({ directory: "/models", files: ["alpha.gguf"] }),
      "config.save": (args) => {
        saved.push(args.config as AppConfig);
        return args.config as AppConfig;
      },
    });
    const { controller } = await renderApp(<ModelsTab />, handlers);
    fireEvent.change(screen.getByTestId("model-directory"), { target: { value: "/models" } });
    await new Promise((r) => setTimeout(r, 20));
    await userEvent.click(screen.getByTestId("model-radio-alpha.gguf"));
    await userEvent.click(screen.getByTestId("load-model"));
    await new Promise((r) => setTimeout(r, 20));
    expect(saved[saved.length - 1].model.selectedModel).toBe("/models/alpha.gguf");
    expect(screen.getByTestId("loaded-model-indicator").textContent).toMatch(/alpha.gguf/);
    controller.dispose();
  });

  it("shows saving feedback while the selected model is being persisted", async () => {
    let finishSave: ((config: AppConfig) => void) | null = null;
    let saveCount = 0;
    const handlers = baselineHandlers({
      "model.list": () => ({ directory: "/models", files: ["alpha.gguf"] }),
      "config.save": (args) => {
        saveCount += 1;
        if (saveCount === 1) return args.config as AppConfig;
        return new Promise<AppConfig>((resolve) => {
          finishSave = resolve;
          setTimeout(() => finishSave?.(args.config as AppConfig), 20);
        });
      },
    });
    const { controller } = await renderApp(<ModelsTab />, handlers);
    fireEvent.change(screen.getByTestId("model-directory"), { target: { value: "/models" } });
    await new Promise((r) => setTimeout(r, 20));
    await userEvent.click(screen.getByTestId("model-radio-alpha.gguf"));
    await userEvent.click(screen.getByTestId("load-model"));
    expect(screen.getByTestId("load-model").textContent).toMatch(/saving/i);
    await new Promise((r) => setTimeout(r, 40));
    expect(screen.getByTestId("model-selection-status").textContent).toMatch(/saved/i);
    controller.dispose();
  });

  it("Unload clears the model selection", async () => {
    const saved: AppConfig[] = [];
    const handlers = baselineHandlers({
      "config.load": () => baselineConfig({ model: { directory: "/models", selectedModel: "/models/alpha.gguf" } }),
      "config.save": (args) => {
        saved.push(args.config as AppConfig);
        return args.config as AppConfig;
      },
    });
    const { controller } = await renderApp(<ModelsTab />, handlers);
    await userEvent.click(screen.getByTestId("unload-model"));
    await new Promise((r) => setTimeout(r, 20));
    expect(saved[saved.length - 1].model.selectedModel).toBe("");
    expect(screen.getByTestId("loaded-model-indicator").textContent).toMatch(/no model selected/i);
    controller.dispose();
  });
});
