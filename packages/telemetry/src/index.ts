import { metrics } from "@opentelemetry/api";
import { OTLPMetricExporter } from "@opentelemetry/exporter-metrics-otlp-proto";
import { OTLPTraceExporter } from "@opentelemetry/exporter-trace-otlp-proto";
import { resourceFromAttributes } from "@opentelemetry/resources";
import {
  MeterProvider,
  PeriodicExportingMetricReader,
} from "@opentelemetry/sdk-metrics";
import {
  BatchSpanProcessor,
  NodeTracerProvider,
} from "@opentelemetry/sdk-trace-node";
import {
  loadOtlpConfig,
  otlpServiceName,
  otlpSignalUrl,
} from "@bb/config/otlp";

export interface Telemetry {
  shutdown(): Promise<void>;
}

interface StartTelemetryOptions {
  component: string;
  env?: NodeJS.ProcessEnv;
  metricExportIntervalMs?: number;
}

const DEFAULT_METRIC_EXPORT_INTERVAL_MS = 15_000;

export function startTelemetry(options: StartTelemetryOptions): Telemetry {
  const config = loadOtlpConfig({ env: options.env ?? process.env });
  const endpoint = config.BB_OTLP_ENDPOINT;
  if (endpoint === null) {
    return { shutdown: async () => {} };
  }
  const resource = resourceFromAttributes({
    "service.name": otlpServiceName(options.component),
    "service.version": config.BB_APP_VERSION,
  });
  const tracerProvider = new NodeTracerProvider({
    resource,
    spanProcessors: [
      new BatchSpanProcessor(
        new OTLPTraceExporter({ url: otlpSignalUrl(endpoint, "traces") }),
      ),
    ],
  });
  tracerProvider.register();
  const meterProvider = new MeterProvider({
    resource,
    readers: [
      new PeriodicExportingMetricReader({
        exporter: new OTLPMetricExporter({
          url: otlpSignalUrl(endpoint, "metrics"),
        }),
        exportIntervalMillis:
          options.metricExportIntervalMs ?? DEFAULT_METRIC_EXPORT_INTERVAL_MS,
      }),
    ],
  });
  metrics.setGlobalMeterProvider(meterProvider);
  return {
    shutdown: async () => {
      await Promise.allSettled([
        tracerProvider.shutdown(),
        meterProvider.shutdown(),
      ]);
    },
  };
}
