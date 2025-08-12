import { create } from "zustand";
import { devtools } from "zustand/middleware";
import { ensureLinterInitialized } from "@/features/linter/model/linter.factory";
import { scanSelectedElementWithMeta } from "@/processes/scan/scan-selected-element";
import type { RuleResult } from "@/features/linter/model/rule.types";
import type { ElementContext } from "@/entities/element/model/element-context.types";
import type { ElementRole } from "@/features/linter/model/linter.types";

interface ElementLintState {
  results: RuleResult[];
  contexts: ElementContext[];
  classNames: string[];
  roles: ElementRole[];
  loading: boolean;
  error: string | null;
}

interface ElementLintActions {
  refresh: () => Promise<void>;
  clear: () => void;
}

type ElementLintStore = ElementLintState & ElementLintActions;

const initialState: ElementLintState = {
  results: [],
  contexts: [],
  classNames: [],
  roles: [],
  loading: false,
  error: null,
};

export const useElementLintStore = create<ElementLintStore>()(
  devtools(
    (set, get) => ({
      ...initialState,

      refresh: async () => {
        if (get().loading) return;
        try {
          ensureLinterInitialized("balanced");
          set({ loading: true, error: null });
          const wf: any = (window as any).webflow;
          if (!wf || typeof wf.getSelectedElement !== "function") {
            set({ results: [], contexts: [], classNames: [], roles: [], loading: false });
            return;
          }
          const el = await wf.getSelectedElement();
          if (!el || typeof el.getStyles !== "function") {
            set({ results: [], contexts: [], classNames: [], roles: [], loading: false });
            return;
          }
          const meta = await scanSelectedElementWithMeta(el);
          set({
            results: meta.results,
            classNames: meta.classNames || [],
            contexts: meta.contexts || [],
            roles: meta.roles || [],
            loading: false,
          });
        } catch (err: unknown) {
          // eslint-disable-next-line no-console
          console.error("[ElementLintStore] refresh failed", err);
          set({ ...initialState, error: err instanceof Error ? err.message : "Failed to lint element" });
        }
      },

      clear: () => set({ ...initialState }),
    }),
    { name: "element-lint-store", serialize: { options: true } }
  )
);

// One-time subscription to Designer selection events
(() => {
  try {
    const wf: any = (window as any).webflow;
    if (!wf || typeof wf.subscribe !== "function") return;
    ensureLinterInitialized("balanced");
    wf.subscribe("selectedelement", async (el: any) => {
      const g: any = window as any;
      if (g.__flowlint_ignoreNextSelectedEvent) {
        g.__flowlint_ignoreNextSelectedEvent = false;
        return;
      }
      if (!el || typeof el.getStyles !== "function") {
        useElementLintStore.setState({ results: [], contexts: [], classNames: [], roles: [], loading: false });
        return;
      }
      useElementLintStore.setState({ loading: true, error: null });
      try {
        const meta = await scanSelectedElementWithMeta(el);
        useElementLintStore.setState({
          results: meta.results,
          classNames: meta.classNames || [],
          contexts: meta.contexts || [],
          roles: meta.roles || [],
          loading: false,
        });
      } catch (err) {
        // eslint-disable-next-line no-console
        console.error("[ElementLintStore] event lint failed", err);
        useElementLintStore.setState({ ...initialState, error: "Failed to lint element" });
      }
    });
  } catch {
    // ignore boot errors in non-designer contexts
  }
})();

// Compatibility hook
export const useElementLint = useElementLintStore;


