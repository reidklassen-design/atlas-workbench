import type { AppError } from "@/config/types";
import { invoke as tauriInvoke } from "@tauri-apps/api/core";
import { listen as tauriListen } from "@tauri-apps/api/event";

export type IpcEventName = "log" | "status" | "error" | "notice" | "training-complete";
export type EventListener = (payload: unknown) => void;
export type EventListeners = Map<IpcEventName, EventListener[]>;

export interface InvokeTransport {
  invoke: (cmd: string, args?: Record<string, unknown>) => Promise<unknown>;
  on: (event: IpcEventName, listener: (payload: unknown) => void) => () => void;
}

interface TauriGlobals {
  __TAURI_INTERNALS__?: unknown;
}

let currentTransport: InvokeTransport | null = null;

function uuid(): string {
  if (typeof crypto !== "undefined" && "randomUUID" in crypto) return crypto.randomUUID();
  return `${Date.now()}-${Math.random().toString(16).slice(2)}`;
}

function commandName(cmd: string): string {
  return cmd.replace(/([a-z0-9])([A-Z])/g, "$1_$2").replace(/\./g, "_").toLowerCase();
}

function appError(scope: string, title: string, message: string, fix: string): AppError {
  return { id: uuid(), scope, title, message, fix, ts: Date.now() };
}

function messageFromUnknown(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}

function eventChannelError(event: IpcEventName, err: unknown): AppError {
  return appError(
    "ipc",
    "Desktop event channel unavailable",
    `Atlas could not subscribe to the ${event} event stream: ${messageFromUnknown(err)}`,
    "Reinstall the current Atlas Workbench package so Tauri event permissions are included, then restart the app.",
  );
}

export function createTauriTransport(): InvokeTransport {
  return {
    async invoke(cmd: string, args: Record<string, unknown> = {}): Promise<unknown> {
      if (!isTauriHost()) {
        throw appError("ipc", "Desktop backend unavailable", "Atlas Workbench is not running inside the Tauri desktop shell.", "Launch the installed desktop app instead of opening the web assets directly.");
      }
      try {
        return await tauriInvoke(commandName(cmd), args);
      } catch (err) {
        if (typeof err === "object" && err && "title" in err && "message" in err && "fix" in err) throw err;
        const message = err instanceof Error ? err.message : String(err);
        throw appError("ipc", "Desktop command failed", message, "Check the displayed path or setting, then try again.");
      }
    },
    on(event: IpcEventName, listener: (payload: unknown) => void): () => void {
      let disposed = false;
      let unlisten: (() => void) | null = null;
      if (isTauriHost()) {
        void tauriListen(event, (ev) => listener(ev.payload))
          .then((fn) => {
            if (disposed) fn();
            else unlisten = fn;
          })
          .catch((err) => {
            if (disposed) return;
            const error = eventChannelError(event, err);
            if (event === "error") {
              listener(error);
            } else {
              // Keep this visible in devtools, but rely on the error stream
              // subscription to surface the actionable message in the UI.
              console.error(error.message);
            }
          });
      }
      return () => {
        disposed = true;
        if (unlisten) unlisten();
      };
    },
  };
}

export function setTransport(transport: InvokeTransport | null): void {
  currentTransport = transport;
}

export function getTransport(): InvokeTransport {
  if (!currentTransport) {
    if (typeof window !== "undefined" && isTauriHost()) {
      currentTransport = createTauriTransport();
    } else {
      throw appError("ipc", "Desktop backend unavailable", "No IPC transport is configured.", "Launch Atlas Workbench as the desktop app or register a transport for tests.");
    }
  }
  return currentTransport;
}

export function invoke<T = unknown>(cmd: string, args?: Record<string, unknown>): Promise<T> {
  return getTransport().invoke(cmd, args) as Promise<T>;
}

export function onEvent(event: IpcEventName, listener: (payload: unknown) => void): () => void {
  return getTransport().on(event, listener);
}

export interface MockTransportHandlers {
  [cmd: string]: (args: Record<string, unknown>) => Promise<unknown> | unknown;
}

export function createMockTransport(handlers: MockTransportHandlers = {}, eventListeners: EventListeners = new Map()): InvokeTransport {
  return {
    async invoke(cmd: string, args: Record<string, unknown> = {}): Promise<unknown> {
      const handler = handlers[cmd];
      if (!handler) throw appError("test", "Unknown command", `No mock handler for “${cmd}”.`, "Register the command in the mock transport.");
      return Promise.resolve(handler(args));
    },
    on(event: IpcEventName, listener: (payload: unknown) => void): () => void {
      const list = eventListeners.get(event) ?? [];
      list.push(listener);
      eventListeners.set(event, list);
      return () => {
        const arr = eventListeners.get(event);
        if (!arr) return;
        const idx = arr.indexOf(listener);
        if (idx >= 0) arr.splice(idx, 1);
      };
    },
  };
}

export function emitToMock(eventListeners: EventListeners, event: IpcEventName, payload: unknown): void {
  const arr = eventListeners.get(event);
  if (arr) for (const fn of arr.slice()) fn(payload);
}

export function isTauriHost(): boolean {
  return typeof window !== "undefined" && Boolean((window as unknown as TauriGlobals).__TAURI_INTERNALS__);
}
