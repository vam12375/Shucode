import { useShucodeStoreWithDefault } from "@/store/StoreProvider.js";

export function useIsOfficeMode(): boolean {
  return useShucodeStoreWithDefault((state) => state.interfaceMode === "office", false);
}
