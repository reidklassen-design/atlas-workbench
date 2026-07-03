import { createContext, useContext, useEffect, useRef, useSyncExternalStore, type ReactNode } from "react";
import { AppController, type ControllerDeps } from "./appController";

const ControllerContext = createContext<AppController | null>(null);

interface AppProviderProps {
  children: ReactNode;
  controller?: AppController;
  deps?: ControllerDeps;
  autoInit?: boolean;
}

export function AppProvider({ children, controller, deps, autoInit = true }: AppProviderProps): JSX.Element {
  const ref = useRef<AppController | null>(null);
  if (!ref.current && !controller) ref.current = new AppController(deps);
  const ctrl = controller ?? ref.current;
  if (!ctrl) throw new Error("AppProvider requires a controller or deps to create one");
  useEffect(() => {
    if (!autoInit) return;
    void ctrl.init();
    return () => ctrl.dispose();
  }, [ctrl, autoInit]);
  return <ControllerContext.Provider value={ctrl}>{children}</ControllerContext.Provider>;
}

export function useAppController(): AppController {
  const ctrl = useContext(ControllerContext);
  if (!ctrl) throw new Error("useAppController must be used within an AppProvider");
  return ctrl;
}

export function useControllerState<T>(selector: (c: AppController) => T): T {
  const ctrl = useAppController();
  return useSyncExternalStore(
    ctrl.subscribe,
    () => selector(ctrl),
    () => selector(ctrl),
  );
}
