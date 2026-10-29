import * as React from "react";

import { traceOverlayOpen } from "../../lib/perf-trace.js";

export function OverlayOpenTracer({ kind }: { kind: string }): null {
  React.useLayoutEffect(() => {
    traceOverlayOpen(kind);
  }, [kind]);
  return null;
}
