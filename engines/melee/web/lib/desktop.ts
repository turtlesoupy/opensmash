export type DesktopBridge = {
  protocol: 1;
  embedded: boolean;
  onOpenSettings: (callback: () => void) => () => void;
  beginGame: (session: string) => Promise<unknown>;
  setGameActive: (active: boolean) => void;
  input: (code: string | null, down: boolean) => void;
  fullscreen: (value?: boolean) => Promise<void>;
  storage: Pick<Storage, "getItem" | "setItem" | "removeItem">;
  chooseDisc: () => Promise<{ cancelled?: boolean; accepted?: boolean }>;
};
declare global {
  interface Window {
    meleeDesktop?: DesktopBridge;
  }
}
export const desktop = () => window.meleeDesktop;

export const preferences = {
  getItem: (key: string) => (desktop()?.storage || localStorage).getItem(key),
  setItem: (key: string, value: string) => (desktop()?.storage || localStorage).setItem(key, value),
  removeItem: (key: string) => (desktop()?.storage || localStorage).removeItem(key),
};
