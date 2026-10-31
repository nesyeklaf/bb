import { DEFAULTS } from "./defaults.js";
import {
  readEnvVarWithDefault,
  resolveEnvLoader,
  type EnvLoaderArgs,
} from "./env.js";
import { BB_APP_VERSION_ENV, BB_OTLP_ENDPOINT_ENV } from "./env-vars.js";

export interface OtlpConfig {
  BB_APP_VERSION: string;
  BB_OTLP_ENDPOINT: string | null;
}

export function loadOtlpConfig(args: EnvLoaderArgs = {}): OtlpConfig {
  const loader = resolveEnvLoader(args);
  return {
    BB_APP_VERSION: readEnvVarWithDefault({
      context: loader.context,
      defaultValue: DEFAULTS.appVersion,
      definition: BB_APP_VERSION_ENV,
      env: loader.env,
    }),
    BB_OTLP_ENDPOINT: readEnvVarWithDefault({
      context: loader.context,
      defaultValue: null,
      definition: BB_OTLP_ENDPOINT_ENV,
      env: loader.env,
    }),
  };
}

export function otlpServiceName(component: string): string {
  return `bb-${component}`;
}

export function otlpSignalUrl(
  endpoint: string,
  signal: "logs" | "metrics" | "traces",
): string {
  return `${endpoint}/v1/${signal}`;
}
