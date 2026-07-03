import { randomUUID } from "node:crypto";
import { Backend, CommandError } from "./backend";
import type { AppError } from "@/config/types";
import type { InvokeTransport, IpcEventName } from "./transport";

function toAppError(err: CommandError): AppError {
  return { id: randomUUID(), scope: err.scope, title: err.title, message: err.message, fix: err.fix, ts: Date.now() };
}

export function createBackendTransport(backend: Backend): InvokeTransport {
  return {
    async invoke(cmd: string, args: Record<string, unknown> = {}): Promise<unknown> {
      try {
        return await backend.handle(cmd, args);
      } catch (err) {
        if (err instanceof CommandError) throw toAppError(err);
        if (err instanceof Error) {
          const wrapped: AppError = { id: randomUUID(), scope: "ipc", title: "Something went wrong", message: err.message, fix: "Try again. If the problem persists, restart Atlas Workbench.", ts: Date.now() };
          throw wrapped;
        }
        throw err;
      }
    },
    on(event: IpcEventName, listener: (payload: unknown) => void): () => void {
      backend.on(event, listener);
      return () => backend.off(event, listener);
    },
  };
}
