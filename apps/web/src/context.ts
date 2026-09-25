import type { Context } from "cordis";
import { inject, onScopeDispose, type InjectionKey } from "vue";
export const contextKey: InjectionKey<Context> = Symbol("kovela.context");
export function useContext(): Context {
  const parent = inject(contextKey);
  if (!parent) throw new Error("Cordis context is unavailable");
  const scope = parent.plugin(() => {});
  onScopeDispose(() => void scope.dispose());
  return scope.ctx;
}
