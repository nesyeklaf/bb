// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { useRef } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { useSidebarThreadPrefetch } from "./useSidebarThreadPrefetch";

const prefetchThreadOpen = vi.hoisted(() => vi.fn());
vi.mock("@/hooks/queries/thread-queries", () => ({ prefetchThreadOpen }));

function Sidebar() {
  const ref = useRef<HTMLDivElement | null>(null);
  useSidebarThreadPrefetch(ref);
  return (
    <>
      <div ref={ref}>
        <a href="/a" data-sidebar-thread-id="thr_a">
          <span>A</span>
        </a>
        <a href="/b" data-sidebar-thread-id="thr_b">
          B
        </a>
      </div>
      <a href="/c" data-sidebar-thread-id="thr_outside">
        C
      </a>
    </>
  );
}

function renderSidebar() {
  render(
    <QueryClientProvider client={new QueryClient()}>
      <Sidebar />
    </QueryClientProvider>,
  );
}

function prefetchedIds(): string[] {
  return prefetchThreadOpen.mock.calls.map((call) => call[1] as string);
}

describe("useSidebarThreadPrefetch", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    prefetchThreadOpen.mockReset();
  });

  afterEach(() => {
    cleanup();
    vi.useRealTimers();
  });

  it("prefetches a thread once the mouse rests on its row", () => {
    renderSidebar();
    fireEvent.pointerOver(screen.getByText("A"), { pointerType: "mouse" });
    fireEvent.pointerOver(screen.getByText("A").parentElement!, {
      pointerType: "mouse",
    });
    expect(prefetchedIds()).toEqual([]);
    vi.advanceTimersByTime(100);
    expect(prefetchedIds()).toEqual(["thr_a"]);
  });

  it("skips rows the mouse only passes over", () => {
    renderSidebar();
    fireEvent.pointerOver(screen.getByText("A"), { pointerType: "mouse" });
    vi.advanceTimersByTime(20);
    fireEvent.pointerOver(screen.getByText("B"), { pointerType: "mouse" });
    vi.advanceTimersByTime(100);
    expect(prefetchedIds()).toEqual(["thr_b"]);
  });

  it("prefetches on press without waiting, including touch", () => {
    renderSidebar();
    fireEvent.pointerOver(screen.getByText("B"), { pointerType: "touch" });
    fireEvent.pointerDown(screen.getByText("B"), { pointerType: "touch" });
    expect(prefetchedIds()).toEqual(["thr_b"]);
    vi.advanceTimersByTime(100);
    expect(prefetchedIds()).toEqual(["thr_b"]);
  });

  it("ignores thread links outside the sidebar", () => {
    renderSidebar();
    fireEvent.pointerOver(screen.getByText("C"), { pointerType: "mouse" });
    fireEvent.pointerDown(screen.getByText("C"), { pointerType: "mouse" });
    vi.advanceTimersByTime(100);
    expect(prefetchedIds()).toEqual([]);
  });
});
