import { useEffect, type RefObject } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { prefetchThreadOpen } from "@/hooks/queries/thread-queries";

const HOVER_INTENT_MS = 60;
const SIDEBAR_THREAD_LINK_SELECTOR = "a[data-sidebar-thread-id]";

function sidebarThreadIdAt(
  root: HTMLElement | null,
  target: EventTarget | null,
): string | null {
  if (root === null || !(target instanceof Element)) return null;
  const link = target.closest<HTMLAnchorElement>(SIDEBAR_THREAD_LINK_SELECTOR);
  if (link === null || !root.contains(link)) return null;
  return link.dataset.sidebarThreadId || null;
}

export function useSidebarThreadPrefetch(
  rootRef: RefObject<HTMLElement | null>,
): void {
  const queryClient = useQueryClient();
  useEffect(() => {
    let pending: { threadId: string; timer: number } | null = null;
    const cancel = () => {
      if (pending === null) return;
      window.clearTimeout(pending.timer);
      pending = null;
    };
    const handlePointerOver = (event: PointerEvent) => {
      if (event.pointerType !== "mouse") return;
      const threadId = sidebarThreadIdAt(rootRef.current, event.target);
      if (threadId !== null && threadId === pending?.threadId) return;
      cancel();
      if (threadId === null) return;
      const timer = window.setTimeout(() => {
        pending = null;
        prefetchThreadOpen(queryClient, threadId);
      }, HOVER_INTENT_MS);
      pending = { threadId, timer };
    };
    const handlePointerDown = (event: PointerEvent) => {
      const threadId = sidebarThreadIdAt(rootRef.current, event.target);
      if (threadId === null) return;
      cancel();
      prefetchThreadOpen(queryClient, threadId);
    };
    document.addEventListener("pointerover", handlePointerOver);
    document.addEventListener("pointerdown", handlePointerDown, true);
    return () => {
      document.removeEventListener("pointerover", handlePointerOver);
      document.removeEventListener("pointerdown", handlePointerDown, true);
      cancel();
    };
  }, [queryClient, rootRef]);
}
