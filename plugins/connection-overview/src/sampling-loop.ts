import {
  TICK_MS,
  createSampler,
  type ProcFs,
  type Sampler,
} from "./sampler.js";

export function startSamplingLoop(options: {
  fs: ProcFs;
  rootPid: number;
  generation: string;
  signal: AbortSignal;
  excludedRoots?: () => ReadonlySet<number>;
  onError: (error: unknown) => void;
}): Sampler {
  const sampler = createSampler(options);
  let running = false;
  const timer = setInterval(() => {
    if (running) return;
    running = true;
    sampler
      .tick()
      .catch(options.onError)
      .finally(() => {
        running = false;
      });
  }, TICK_MS);
  timer.unref?.();
  options.signal.addEventListener("abort", () => clearInterval(timer), {
    once: true,
  });
  void sampler.tick().catch(options.onError);
  return sampler;
}
