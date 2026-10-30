import { describe, expect, it } from "vitest";
import {
  resolveShellLoadPath,
  resolveShellScreenState,
  revealsShellFailure,
  type ShellLoadPhase,
} from "./shell-state";

const READY: ShellLoadPhase = { kind: "ready" };

const BASE = { storeReady: true, hasAnyProfile: true };

describe("resolveShellScreenState", () => {
  it("sends a phone with no server to the add-server screen", () => {
    expect(
      resolveShellScreenState({
        storeReady: true,
        hasAnyProfile: false,
        hasProfile: false,
        load: { kind: "loading" },
      }),
    ).toEqual({ kind: "no-profile" });
  });

  it("waits for the profile store before deciding anything", () => {
    expect(
      resolveShellScreenState({
        storeReady: false,
        hasAnyProfile: false,
        hasProfile: false,
        load: { kind: "loading" },
      }).kind,
    ).toBe("loading");
  });
  it("shows the page once a Direct profile is loaded", () => {
    expect(
      resolveShellScreenState({
        ...BASE,
        hasProfile: true,
        load: READY,
      }),
    ).toEqual({ kind: "webview", serverErrorStatus: null });
  });

  it("reports a failed load with a retry", () => {
    const state = resolveShellScreenState({
      ...BASE,
      hasProfile: true,
      load: { kind: "failed", detail: "The network connection was lost." },
    });
    expect(state).toEqual({
      kind: "error",
      title: "The page did not load",
      detail: "The network connection was lost.",
      action: "retry",
    });
  });

  it("shows the server's own error page instead of replacing it", () => {
    expect(
      resolveShellScreenState({
        ...BASE,
        hasProfile: true,
        load: { kind: "http-error", status: 503 },
      }),
    ).toEqual({ kind: "webview", serverErrorStatus: 503 });
  });

  it("keeps the WebView mounted while a load is in flight", () => {
    expect(
      resolveShellScreenState({
        ...BASE,
        hasProfile: true,
        load: { kind: "loading" },
      }),
    ).toEqual({ kind: "webview", serverErrorStatus: null });
  });

  it("waits for the profile", () => {
    expect(
      resolveShellScreenState({
        ...BASE,
        hasProfile: false,
        load: { kind: "loading" },
      }).kind,
    ).toBe("loading");
  });
});

describe("revealsShellFailure", () => {
  const page = (serverErrorStatus: number | null) =>
    ({ kind: "webview", serverErrorStatus }) as const;

  it("reveals error screens and server error pages", () => {
    expect(
      revealsShellFailure({
        kind: "error",
        title: "",
        detail: "",
        action: "retry",
      }),
    ).toBe(true);
    expect(revealsShellFailure(page(500))).toBe(true);
    expect(revealsShellFailure(page(401))).toBe(true);
    expect(revealsShellFailure(page(null))).toBe(false);
  });
});

describe("resolveShellLoadPath", () => {
  it("reloads the page where the user is, not where it was first opened", () => {
    expect(
      resolveShellLoadPath({
        visitedPath: "/projects/p1/threads/thr_new",
        requestedPath: "/projects/p1/threads/thr_notified",
      }),
    ).toBe("/projects/p1/threads/thr_new");
  });

  it("opens a requested thread before the page reports where it is", () => {
    expect(
      resolveShellLoadPath({
        visitedPath: null,
        requestedPath: "/projects/p1/threads/thr_notified",
      }),
    ).toBe("/projects/p1/threads/thr_notified");
  });

  it("opens the new-thread page on a cold start", () => {
    expect(
      resolveShellLoadPath({ visitedPath: null, requestedPath: undefined }),
    ).toBe("/");
    expect(resolveShellLoadPath({ visitedPath: null, requestedPath: "" })).toBe(
      "/",
    );
  });
});
