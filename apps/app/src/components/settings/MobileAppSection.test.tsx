// @vitest-environment jsdom
import {
  PluginSettingsSections,
  PluginMobileSettingsSections,
} from "@/components/plugin/PluginSettingsSections";
import {
  setPluginSlotRegistrations,
  resetPluginSlotStoreForTest,
} from "@/lib/plugin-slots";
import { makePluginRegistrationSet } from "@/test/fixtures/plugins";
import { act, cleanup, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { sdk } from "@/lib/sdk";
import { MemoryRouter } from "react-router-dom";
import { makeSystemConfig } from "@/test/fixtures/system-config";
import { MobileAppSection } from "./MobileAppSection";

beforeEach(() => {
  vi.spyOn(sdk.system, "config").mockResolvedValue(makeSystemConfig());
});

afterEach(() => {
  cleanup();
  resetPluginSlotStoreForTest();
  vi.restoreAllMocks();
});

function renderSection() {
  return render(
    <QueryClientProvider
      client={
        new QueryClient({ defaultOptions: { queries: { retry: false } } })
      }
    >
      <MemoryRouter>
        <MobileAppSection />
      </MemoryRouter>
    </QueryClientProvider>,
  );
}

it("places mobile plugin sections only on Mobile and removes them when unregistered", async () => {
  setPluginSlotRegistrations(
    "connection",
    makePluginRegistrationSet({
      settingsSections: [
        {
          id: "pair",
          experimental_page: "mobile",
          component: () => <p>Pair this phone</p>,
        },
        { id: "manage", component: () => <p>Manage connection</p> },
      ],
    }),
  );
  vi.mocked(sdk.system.config).mockResolvedValue(
    makeSystemConfig({
      serverAccess: {
        defaultProviderId: "relay",
        effectiveUrl: null,
        urlSource: null,
        providers: [
          {
            id: "relay",
            displayName: "Relay",
            description: "Relay",
            pluginId: "connection",
            availability: { status: "available" },
          },
        ],
      },
    }),
  );
  const mobile = renderSection();
  const plugin = render(
    <MemoryRouter>
      <PluginSettingsSections pluginId="connection" />
    </MemoryRouter>,
  );
  expect(await screen.findByText("Pair this phone")).toBeTruthy();
  expect(mobile.container.textContent).not.toContain("Manage connection");
  expect(plugin.container.textContent).toContain("Manage connection");
  expect(plugin.container.textContent).not.toContain("Pair this phone");
  act(() =>
    setPluginSlotRegistrations("connection", makePluginRegistrationSet()),
  );
  expect(screen.queryByText("Pair this phone")).toBeNull();
});

it("hides pairing slots when Direct or a different provider is selected", () => {
  setPluginSlotRegistrations(
    "connection",
    makePluginRegistrationSet({
      settingsSections: [
        {
          id: "pair",
          experimental_page: "mobile",
          component: () => <p>Pair this phone</p>,
        },
      ],
    }),
  );
  const view = (pluginId: string | null) => (
    <MemoryRouter>
      <PluginMobileSettingsSections pluginId={pluginId} />
    </MemoryRouter>
  );
  const rendered = render(view("connection"));
  expect(screen.getByText("Pair this phone")).toBeTruthy();
  rendered.rerender(view(null));
  expect(screen.queryByText("Pair this phone")).toBeNull();
  rendered.rerender(view("other-provider"));
  expect(screen.queryByText("Pair this phone")).toBeNull();
  rendered.rerender(view("connection"));
  expect(screen.getByText("Pair this phone")).toBeTruthy();
});
