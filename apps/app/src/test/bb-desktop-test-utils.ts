import type {
  BbDesktopApi,
  BbDesktopBrowserApi,
  BbDesktopInfo,
} from "@bb/desktop-contract";

export function createNoopDesktopBrowserApi(): BbDesktopBrowserApi {
  return {
    attach() {},
    detach() {},
    navigate() {},
    goBack() {},
    goForward() {},
    reload() {},
    stop() {},
    focus() {},
    setBounds() {},
    setVisible() {},
    setVisibleWithoutFocus() {},
    onState() {
      return () => {};
    },
    onOpenTab() {
      return () => {};
    },
    onFocus() {
      return () => {};
    },
  };
}

export function createBbDesktopApi(
  info: BbDesktopInfo,
  browser: BbDesktopBrowserApi = createNoopDesktopBrowserApi(),
): BbDesktopApi {
  return {
    ...info,
    browser,
    async getInfo() {
      return info;
    },
    onChange() {
      return () => {};
    },
    setTheme() {},
    openExternalUrl() {},
  };
}
