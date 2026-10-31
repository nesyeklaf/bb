import { context, metrics, propagation, trace } from "@opentelemetry/api";
import { afterEach, describe, expect, it } from "vitest";
import { startTelemetry } from "../src/index.js";
import { startOtlpReceiver } from "../src/testing.js";

afterEach(() => {
  trace.disable();
  metrics.disable();
  context.disable();
  propagation.disable();
});

describe("startTelemetry", () => {
  it("registers nothing when no OTLP endpoint is configured", async () => {
    const telemetry = startTelemetry({ component: "server", env: {} });
    const span = trace.getTracer("probe").startSpan("probe");
    expect(span.isRecording()).toBe(false);
    span.end();
    await telemetry.shutdown();
  });

  it("exports spans and metrics to the configured endpoint on shutdown", async () => {
    const receiver = await startOtlpReceiver();
    try {
      const telemetry = startTelemetry({
        component: "host-daemon",
        env: { BB_OTLP_ENDPOINT: receiver.endpoint, BB_APP_VERSION: "9.9.9" },
      });
      trace.getTracer("probe").startActiveSpan("probe-span", (span) => {
        span.end();
      });
      metrics.getMeter("probe").createCounter("probe_counter").add(3);
      await telemetry.shutdown();

      const traces = receiver.requests.find(
        (request) => request.path === "/v1/traces",
      );
      const exportedMetrics = receiver.requests.find(
        (request) => request.path === "/v1/metrics",
      );
      expect(traces?.contentType).toBe("application/x-protobuf");
      expect(traces?.body.includes("probe-span")).toBe(true);
      expect(traces?.body.includes("bb-host-daemon")).toBe(true);
      expect(traces?.body.includes("9.9.9")).toBe(true);
      expect(exportedMetrics?.body.includes("probe_counter")).toBe(true);
    } finally {
      await receiver.close();
    }
  });
});
