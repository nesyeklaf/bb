import {
  currentPlatform,
  missingRuntimeMessage,
  verifyInstalled,
  type RuntimeRelease,
} from "./installer.js";

export const runtimeRelease: RuntimeRelease = {
  package: "dev-browser",
  version: "1.0.0-rc.4",
  artifacts: {
    "linux-x64":
      "fa6cec3f84463e171bd7b307e2e1f0243df59c70c38f96d790dc41b160db921a",
    "linux-arm64":
      "578db7f1e502cf6b9e43ac09e6adc5720f5397fa3e6d6b7b9ba8377708fe040e",
    "darwin-x64":
      "7cfad83f7f9e16dc5acbc94553430bcd1be24adc4304c0f534805969bfa6d2ba",
    "darwin-arm64":
      "f0a7e7d10ab8be0fee1ee8ac2ca33d3efc46b493e5e998b29ea75c79479a2e8d",
  },
};

export interface ResolvedRuntime {
  readonly binary: string;
  readonly version: string;
  readonly source: "release" | "developer-artifact";
}

export async function resolveRuntime(args: {
  dataDir: string;
  signal: AbortSignal;
  release?: RuntimeRelease;
  onProgress?: (detail: string) => void;
}): Promise<ResolvedRuntime> {
  const release = args.release ?? runtimeRelease;
  const platform = currentPlatform();
  if (platform === null)
    throw new Error(
      `DevBrowser has no runtime for ${process.platform}-${process.arch}; choose a Linux or macOS browser host.`,
    );
  args.signal.throwIfAborted();
  const installed = await verifyInstalled(release, args.dataDir, platform);
  if (installed === null)
    throw new Error(missingRuntimeMessage(release, args.dataDir, platform));
  return {
    binary: installed.binary,
    version: release.version,
    source: "release",
  };
}
