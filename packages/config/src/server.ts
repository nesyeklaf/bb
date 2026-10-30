import type { FeatureFlags } from "@bb/domain";
import type { AppSurface } from "./app-surface.js";
import {
  loadCommonConfig,
  type CommonConfig,
  type LoadCommonConfigArgs,
} from "./common.js";
import { loadDatabaseConfig, type DatabaseConfig } from "./database.js";
import { loadDevAppConfig } from "./dev-app.js";
import {
  readEnvVarWithDefault,
  readOptionalEnvVar,
  resolveEnvLoader,
} from "./env.js";
import {
  BB_APP_URL_ENV,
  BB_APP_SURFACE_ENV,
  BB_APP_VERSION_ENV,
  BB_CONNECT_GATE_KEYS_URL_ENV,
  BB_EXTERNAL_URL_ENV,
  BB_INHERITED_SKILLS_ROOTS_ENV,
  BB_SERVER_BIND_HOST_ENV,
  BB_SERVER_LAUNCH_ID_ENV,
  BB_CLI_LAUNCHER_ENV,
  BB_PERF_DIAGNOSTICS_ENV,
  BB_SKIP_ONBOARDING_ENV,
  DEFAULT_BB_APP_URL,
  DEFAULT_BB_APP_SURFACE,
  DEFAULT_BB_APP_VERSION,
  DEFAULT_BB_CONNECT_GATE_KEYS_URL,
  DEFAULT_BB_EXTERNAL_URL,
  DEFAULT_BB_SERVER_BIND_HOST,
  parseServerBindHost,
  type ServerBindHost,
} from "./env-vars.js";
import { loadFeatureFlags } from "./feature-flags.js";
import { assignIfDefined } from "./objects.js";
import { loadHostDaemonPortValue } from "./ports.js";
import { loadServerPortConfig, type ServerPortConfig } from "./server-port.js";

export interface ServerConfig
  extends CommonConfig, DatabaseConfig, ServerPortConfig {
  BB_APP_URL: string;
  BB_APP_SURFACE: AppSurface;
  BB_APP_VERSION: string;
  BB_CONNECT_GATE_KEYS_URL: string;
  BB_DEV_APP_PORT?: number;
  BB_EXTERNAL_URL: string;
  BB_HOST_DAEMON_PORT: number;
  BB_INHERITED_SKILLS_ROOTS: string[];
  BB_SERVER_BIND_HOST: ServerBindHost;
  BB_SERVER_LAUNCH_ID?: string;
  BB_CLI_LAUNCHER?: string;
  BB_PERF_DIAGNOSTICS: boolean;
  BB_SKIP_ONBOARDING: boolean;
  featureFlags: FeatureFlags;
}

type LoadServerConfigArgs = LoadCommonConfigArgs;

export { parseServerBindHost };
export type { ServerBindHost };

export function loadServerConfig(
  args: LoadServerConfigArgs = {},
): ServerConfig {
  const loader = resolveEnvLoader(args);
  const commonConfig = loadCommonConfig({
    env: loader.env,
    homeDir: loader.context.homeDir,
    mode: loader.mode,
    repoRoot: args.repoRoot,
  });
  const databaseConfig = loadDatabaseConfig({
    commonConfig,
    env: loader.env,
    homeDir: loader.context.homeDir,
    mode: loader.mode,
    repoRoot: args.repoRoot,
  });
  const serverPortConfig = loadServerPortConfig({
    env: loader.env,
    homeDir: loader.context.homeDir,
    mode: loader.mode,
    repoRoot: args.repoRoot,
  });
  const devAppConfig = loadDevAppConfig({
    env: loader.env,
    homeDir: loader.context.homeDir,
    mode: loader.mode,
  });
  const config: ServerConfig = {
    ...commonConfig,
    ...databaseConfig,
    ...serverPortConfig,
    BB_APP_URL: readEnvVarWithDefault({
      context: loader.context,
      defaultValue: DEFAULT_BB_APP_URL,
      definition: BB_APP_URL_ENV,
      env: loader.env,
    }),
    BB_APP_SURFACE: readEnvVarWithDefault({
      context: loader.context,
      defaultValue: DEFAULT_BB_APP_SURFACE,
      definition: BB_APP_SURFACE_ENV,
      env: loader.env,
    }),
    BB_APP_VERSION: readEnvVarWithDefault({
      context: loader.context,
      defaultValue: DEFAULT_BB_APP_VERSION,
      definition: BB_APP_VERSION_ENV,
      env: loader.env,
    }),
    BB_CONNECT_GATE_KEYS_URL: readEnvVarWithDefault({
      context: loader.context,
      defaultValue: DEFAULT_BB_CONNECT_GATE_KEYS_URL,
      definition: BB_CONNECT_GATE_KEYS_URL_ENV,
      env: loader.env,
    }),
    BB_EXTERNAL_URL: readEnvVarWithDefault({
      context: loader.context,
      defaultValue: DEFAULT_BB_EXTERNAL_URL,
      definition: BB_EXTERNAL_URL_ENV,
      env: loader.env,
    }),
    BB_HOST_DAEMON_PORT: loadHostDaemonPortValue({
      env: loader.env,
      homeDir: loader.context.homeDir,
      mode: loader.mode,
      repoRoot: args.repoRoot,
    }),
    BB_INHERITED_SKILLS_ROOTS: readEnvVarWithDefault({
      context: loader.context,
      defaultValue: [],
      definition: BB_INHERITED_SKILLS_ROOTS_ENV,
      env: loader.env,
    }),
    BB_SERVER_BIND_HOST: readEnvVarWithDefault({
      context: loader.context,
      defaultValue: DEFAULT_BB_SERVER_BIND_HOST,
      definition: BB_SERVER_BIND_HOST_ENV,
      env: loader.env,
    }),
    BB_PERF_DIAGNOSTICS: readEnvVarWithDefault({
      context: loader.context,
      definition: BB_PERF_DIAGNOSTICS_ENV,
      env: loader.env,
      defaultValue: false,
    }),
    BB_SKIP_ONBOARDING: readEnvVarWithDefault({
      context: loader.context,
      definition: BB_SKIP_ONBOARDING_ENV,
      env: loader.env,
      defaultValue: false,
    }),
    featureFlags: loadFeatureFlags({
      env: loader.env,
      homeDir: loader.context.homeDir,
      mode: loader.mode,
    }),
  };

  assignIfDefined({
    key: "BB_DEV_APP_PORT",
    target: config,
    value: devAppConfig.BB_DEV_APP_PORT,
  });
  assignIfDefined({
    key: "BB_CLI_LAUNCHER",
    target: config,
    value: readOptionalEnvVar({
      context: loader.context,
      definition: BB_CLI_LAUNCHER_ENV,
      env: loader.env,
    }),
  });
  assignIfDefined({
    key: "BB_SERVER_LAUNCH_ID",
    target: config,
    value: readOptionalEnvVar({
      context: loader.context,
      definition: BB_SERVER_LAUNCH_ID_ENV,
      env: loader.env,
    }),
  });

  return config;
}
