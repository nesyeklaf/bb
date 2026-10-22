import { performance } from "node:perf_hooks";

export class AppApi {
  constructor(baseUrl) {
    this.baseUrl = baseUrl.replace(/\/$/, "");
  }

  async timed(path, init) {
    const startedAt = performance.now();
    const response = await fetch(this.baseUrl + "/api/v1" + path, init);
    const body = await response.arrayBuffer();
    const totalMs = performance.now() - startedAt;
    return {
      status: response.status,
      ok: response.ok,
      totalMs,
      bytes: body.byteLength,
      text: () => new TextDecoder().decode(body),
    };
  }

  async json(path) {
    const result = await this.timed(path);
    if (!result.ok)
      throw new Error("GET " + path + " answered " + result.status);
    return JSON.parse(result.text());
  }

  async sidebarThreads() {
    const bootstrap = await this.json("/sidebar-bootstrap");
    const threads = bootstrap.projects.flatMap((project) =>
      project.threads.map((thread) => ({
        id: thread.id,
        projectId: thread.projectId,
        providerId: thread.providerId,
        status: thread.status,
        archived: Boolean(thread.archivedAt),
        pinned: Boolean(thread.pinnedAt),
        title: thread.title,
      })),
    );
    if (bootstrap.personalProject) {
      for (const thread of bootstrap.personalProject.threads ?? [])
        threads.push({
          id: thread.id,
          projectId: thread.projectId,
          providerId: thread.providerId,
          status: thread.status,
          archived: Boolean(thread.archivedAt),
          pinned: Boolean(thread.pinnedAt),
          title: thread.title,
        });
    }
    return threads;
  }

  async weigh(thread) {
    const timeline = await this.json("/threads/" + thread.id + "/timeline");
    return {
      ...thread,
      eventCount: timeline.maxSeq,
      rowCount: timeline.rows.length,
    };
  }

  async rankSidebarThreads(limit = 60) {
    const threads = (await this.sidebarThreads())
      .filter((thread) => !thread.archived && thread.status === "idle")
      .slice(0, limit);
    const weighed = [];
    for (const thread of threads) weighed.push(await this.weigh(thread));
    weighed.sort((a, b) => b.eventCount - a.eventCount);
    return weighed;
  }
}

export const threadUrl = (baseUrl, thread) =>
  baseUrl.replace(/\/$/, "") +
  "/projects/" +
  thread.projectId +
  "/threads/" +
  thread.id;

export const requireThreads = (threads, count, what) => {
  if (threads.length < count)
    throw new Error(
      "Need at least " +
        count +
        " " +
        what +
        " in the fixture, found " +
        threads.length +
        ". Seed more with pnpm seed:perf.",
    );
  return threads;
};
