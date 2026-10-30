import { randomUUID } from "node:crypto";
import type { Context, MiddlewareHandler } from "hono";
import { isTunnelIngressContext } from "../request-context.js";

export const REQUEST_PEER_CAPACITY = 8192;

export interface RequestPeer {
  seq: number;
  at: number;
  address: string | null;
  port: number | null;
  localPort: number | null;
  method: string;
  status: number;
  websocket: boolean;
  tunnelIngress: boolean;
}

export interface RequestPeerSnapshot {
  generation: string;
  capacity: number;
  oldestSeq: number;
  latestSeq: number;
  peers: RequestPeer[];
}

interface SocketPeer {
  address: string | null;
  port: number | null;
  localPort: number | null;
  websocket: boolean;
}

const NO_SOCKET: SocketPeer = {
  address: null,
  port: null,
  localPort: null,
  websocket: false,
};

function socketPeer(context: Context): SocketPeer {
  const env: unknown = context.env;
  if (typeof env !== "object" || env === null || !("incoming" in env)) {
    return NO_SOCKET;
  }
  const incoming: unknown = env.incoming;
  if (
    typeof incoming !== "object" ||
    incoming === null ||
    !("socket" in incoming)
  ) {
    return NO_SOCKET;
  }
  const socket: unknown = incoming.socket;
  if (typeof socket !== "object" || socket === null) return NO_SOCKET;
  const address =
    "remoteAddress" in socket && typeof socket.remoteAddress === "string"
      ? socket.remoteAddress
      : null;
  const port =
    "remotePort" in socket && typeof socket.remotePort === "number"
      ? socket.remotePort
      : null;
  const localPort =
    "localPort" in socket && typeof socket.localPort === "number"
      ? socket.localPort
      : null;
  const websocket = "upgrade" in incoming && incoming.upgrade === true;
  return { address, port, localPort, websocket };
}

export function createRequestPeerRecorder(options?: {
  capacity?: number;
  now?: () => number;
}) {
  const capacity = options?.capacity ?? REQUEST_PEER_CAPACITY;
  const now = options?.now ?? Date.now;
  const generation = randomUUID();
  const ring: (RequestPeer | undefined)[] = new Array<RequestPeer | undefined>(
    capacity,
  );
  let latestSeq = 0;

  function record(entry: Omit<RequestPeer, "seq">): void {
    latestSeq += 1;
    ring[latestSeq % capacity] = { seq: latestSeq, ...entry };
  }

  const middleware: MiddlewareHandler = async (context, next) => {
    const peer = socketPeer(context);
    const tunnelIngress = isTunnelIngressContext(context);
    const at = now();
    let status = 500;
    try {
      await next();
      status = context.res.status;
    } finally {
      record({
        at,
        address: peer.address,
        port: peer.port,
        localPort: peer.localPort,
        method: context.req.method,
        status,
        websocket: peer.websocket,
        tunnelIngress,
      });
    }
  };

  function snapshot(after = 0): RequestPeerSnapshot {
    const oldestSeq = Math.max(1, latestSeq - capacity + 1);
    const start = Math.max(oldestSeq, Math.floor(after) + 1);
    const peers: RequestPeer[] = [];
    for (let seq = start; seq <= latestSeq; seq += 1) {
      const entry = ring[seq % capacity];
      if (entry !== undefined && entry.seq === seq) peers.push({ ...entry });
    }
    return { generation, capacity, oldestSeq, latestSeq, peers };
  }

  return { middleware, snapshot };
}

export type RequestPeerRecorder = ReturnType<typeof createRequestPeerRecorder>;
