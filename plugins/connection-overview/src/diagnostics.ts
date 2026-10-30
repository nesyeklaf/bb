import diagnosticsChannel from "node:diagnostics_channel";
import type { Socket } from "node:net";
import type { HostnameBook } from "./hostnames.js";

interface UndiciConnected {
  connectParams?: { hostname?: string; host?: string };
  socket?: Socket;
}

interface HttpRequestStart {
  request?: {
    host?: string;
    getHeader?: (name: string) => unknown;
    once?: (event: "socket", listener: (socket: Socket) => void) => void;
  };
}

function bindSocket(book: HostnameBook, socket: Socket, hostname: string) {
  const record = () => {
    const { localPort, remoteAddress, remotePort } = socket;
    if (
      localPort === undefined ||
      remoteAddress === undefined ||
      remotePort === undefined
    )
      return;
    book.bind(localPort, remoteAddress, remotePort, hostname);
    socket.once("close", () =>
      book.close(localPort, remoteAddress, remotePort),
    );
  };
  if (socket.remoteAddress !== undefined && !socket.connecting) record();
  else socket.once("connect", record);
}

function stripPort(host: string): string {
  if (host.startsWith("[")) return host.slice(1, host.indexOf("]"));
  const index = host.lastIndexOf(":");
  return index > -1 && host.indexOf(":") === index
    ? host.slice(0, index)
    : host;
}

export function subscribeHostnameChannels(book: HostnameBook): () => void {
  const onUndici = (message: unknown) => {
    const event = message as UndiciConnected;
    const hostname = event.connectParams?.hostname ?? event.connectParams?.host;
    if (event.socket !== undefined && typeof hostname === "string")
      bindSocket(book, event.socket, stripPort(hostname));
  };
  const onHttp = (message: unknown) => {
    const request = (message as HttpRequestStart).request;
    const header = request?.getHeader?.("host");
    const host = typeof header === "string" ? header : request?.host;
    if (request?.once === undefined || typeof host !== "string") return;
    const hostname = stripPort(host);
    request.once("socket", (socket) => bindSocket(book, socket, hostname));
  };
  diagnosticsChannel.subscribe("undici:client:connected", onUndici);
  diagnosticsChannel.subscribe("http.client.request.start", onHttp);
  return () => {
    diagnosticsChannel.unsubscribe("undici:client:connected", onUndici);
    diagnosticsChannel.unsubscribe("http.client.request.start", onHttp);
  };
}
