import { describe, it, expect } from "vitest";
import { screen, fireEvent } from "@testing-library/react";
import { SettingsTab } from "@/ui/tabs/SettingsTab";
import { renderApp, baselineHandlers, baselineConfig, defaultServerFlags } from "./helpers";
import { SERVER_FLAGS } from "@/config/flagCatalog";
import type { AppConfig } from "@/config/types";

const SETTINGS_FLAG_IDS = SERVER_FLAGS.filter((f) => f.id !== "host" && f.id !== "port" && f.id !== "n-gpu-layers").map((f) => f.id);

describe("SettingsTab flags", () => {
  it("renders a widget for every llama.cpp server flag (except host/port)", async () => {
    const { controller } = await renderApp(<SettingsTab />);
    for (const id of SETTINGS_FLAG_IDS) {
      expect(screen.getByTestId(`flag-${id}`)).toBeDefined();
    }
    controller.dispose();
  });

  it("shows a plain-language tooltip for every flag", async () => {
    const { controller } = await renderApp(<SettingsTab />);
    for (const flag of SERVER_FLAGS) {
      if (flag.id === "host" || flag.id === "port" || flag.id === "n-gpu-layers") continue;
      const tooltip = screen.getByTestId(`flag-${flag.id}-tooltip`);
      expect(tooltip.textContent?.length ?? 0).toBeGreaterThan(0);
      expect(tooltip.textContent).toBe(flag.help);
    }
    controller.dispose();
  });

  it("groups flags into section headers", async () => {
    const { controller } = await renderApp(<SettingsTab />);
    expect(screen.getByTestId("flag-section-Sampling")).toBeDefined();
    expect(screen.getByTestId("flag-section-Model Loading")).toBeDefined();
    expect(screen.getByTestId("flag-section-Context & Batching")).toBeDefined();
    controller.dispose();
  });

  it("changing and applying a widget updates the flag passed to the server on next launch", async () => {
    const saved: AppConfig[] = [];
    const handlers = baselineHandlers({
      "config.save": (args) => {
        saved.push(args.config as AppConfig);
        return args.config as AppConfig;
      },
    });
    const { controller } = await renderApp(<SettingsTab />, handlers);
    const ctxWidget = screen.getByTestId("flag-ctx-size");
    const numberInput = ctxWidget.querySelector('input[type="number"]') as HTMLInputElement;
    fireEvent.change(numberInput, { target: { value: "4096" } });
    expect(screen.getByText(/unsaved flag changes/i)).toBeDefined();
    expect(saved.length).toBe(0);
    fireEvent.click(screen.getByTestId("apply-server-flags"));
    await screen.findByText(/server flags applied/i);
    expect(saved[saved.length - 1].serverFlags["ctx-size"]).toBe(4096);
    controller.dispose();
  });

  it("Reset all to defaults restores every flag to its default value", async () => {
    const handlers = baselineHandlers({
      "config.load": () => baselineConfig({ serverFlags: { ...defaultServerFlags(), "ctx-size": 8192, "n-gpu-layers": 30, "flash-attn": "auto" } }),
      "config.save": (args) => args.config as AppConfig,
    });
    const { controller } = await renderApp(<SettingsTab />, handlers);
    const ctxNumber = screen.getByTestId("flag-ctx-size").querySelector('input[type="number"]') as HTMLInputElement;
    expect(ctxNumber.value).toBe("8192");

    fireEvent.click(screen.getByTestId("reset-all-flags"));
    const ctxNumberAfter = screen.getByTestId("flag-ctx-size").querySelector('input[type="number"]') as HTMLInputElement;
    expect(Number(ctxNumberAfter.value)).toBe(Number(defaultServerFlags()["ctx-size"]));
    expect(screen.getByText(/unsaved flag changes/i)).toBeDefined();
    controller.dispose();
  });

  it("persisted flag values are restored from config on render", async () => {
    const handlers = baselineHandlers({
      "config.load": () => baselineConfig({ serverFlags: { ...defaultServerFlags(), "ctx-size": 2048 } }),
    });
    const { controller } = await renderApp(<SettingsTab />, handlers);
    const ctxNumber = screen.getByTestId("flag-ctx-size").querySelector('input[type="number"]') as HTMLInputElement;
    expect(ctxNumber.value).toBe("2048");
    controller.dispose();
  });

  it("exposes the binary path settings section", async () => {
    const { controller } = await renderApp(<SettingsTab />);
    expect(screen.getByTestId("settings-server-binary")).toBeDefined();
    expect(screen.getByTestId("settings-finetune-binary")).toBeDefined();
    expect(screen.getByTestId("save-binary-paths")).toBeDefined();
    controller.dispose();
  });
});
