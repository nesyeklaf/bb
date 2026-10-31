# Observability

bb writes its logs to rotating files under `<data dir>/logs/` (see [debugging-and-qa.md](debugging-and-qa.md)). Setting `BB_OTLP_ENDPOINT` additionally exports logs, traces and metrics over OTLP/HTTP to a receiver of your choice, so errors from every component, plugin and the web app land in one searchable place.

- Export is off by default. `BB_OTLP_ENDPOINT` takes the receiver's base URL, for example `http://127.0.0.1:4318`; bb appends `/v1/logs`, `/v1/traces` and `/v1/metrics`. An empty value turns it off. Only `http` and `https` URLs are accepted. Set it with `npx bb-app env set BB_OTLP_ENDPOINT http://127.0.0.1:4318`, then `bb-app stop && bb-app start`; it is startup-only.
- The file logs stay the source of truth. The OTLP target is a third pino transport next to the files and the console, at the same `BB_LOG_LEVEL`. A receiver that is down drops records; it never blocks or fails bb.
- Each component reports as its own service: `bb-server`, `bb-host-daemon`, and so on, with `service.version` from the bb version. Log fields become record attributes. Plugin lines carry `pluginId` as a field, so one plugin's output can be filtered without parsing the `[plugin:<id>]` prefix.
- The standard `OTEL_*` variables still tune the exporter, for example `OTEL_EXPORTER_OTLP_HEADERS` for a hosted receiver or `OTEL_BLRP_SCHEDULE_DELAY` for the batch interval. bb does not read `OTEL_EXPORTER_OTLP_ENDPOINT` itself, so a value meant for an agent's own tooling never turns on bb's export.

## Traces and metrics

- The server traces every `/api/*` and `/internal/*` request and records the `http.server.request.duration` histogram per route.
- A host RPC from the server to a host daemon carries the W3C `traceparent`, so the daemon's handling shows up as a child span of the request that caused it. A failed RPC marks both spans as errors.
- Log lines written inside a span carry `trace_id` and `span_id`, which links a log record to its trace in Grafana.
- Telemetry flushes for at most three seconds at shutdown; a receiver that is down never delays it longer.

## Web app errors

The web app reports errors caught by React error boundaries (including plugin slots), uncaught render errors, `window` errors and unhandled promise rejections to `POST /api/v1/system/client-errors`. The server writes each report to its log at error level as `Client error: <message>` with `clientErrorSource`, `clientPath`, `clientStack`, `clientComponentStack` and `userAgent`. This happens with or without `BB_OTLP_ENDPOINT`; with it, the reports reach the receiver like any other server log. A page reports each distinct error once and at most 20 errors per load. The SDK exposes the same route as `system.experimental_reportClientError`.

## Local collector

`ops/observability/compose.yaml` runs [grafana/otel-lgtm](https://github.com/grafana/docker-otel-lgtm): an OpenTelemetry Collector with Loki, Tempo, Prometheus and Grafana in one container.

```sh
docker compose -f ops/observability/compose.yaml up -d
```

- Every port binds to `127.0.0.1` only: Grafana on `3000`, OTLP gRPC on `4317`, OTLP HTTP on `4318`. Override them with `BB_LGTM_GRAFANA_PORT`, `BB_LGTM_OTLP_GRPC_PORT` and `BB_LGTM_OTLP_HTTP_PORT`.
- Grafana has no login form, no basic auth and no anonymous access. It signs users in from the `Tailscale-User-Login` header that Tailscale Serve sets, creating each tailnet user as an org admin on first visit. Without that header it answers 401. Its usage reporting and update checks are turned off; at first start it still downloads its Drilldown apps from grafana.com.
- Publish it through Tailscale Serve, tailnet only:

  ```sh
  tailscale serve --bg --https=3000 http://127.0.0.1:3000
  tailscale serve --bg --https=4318 http://127.0.0.1:4318
  ```

  Grafana is then `https://<host>.<tailnet>.ts.net:3000`, and other machines in the tailnet send OTLP to `https://<host>.<tailnet>.ts.net:4318`. Set `BB_LGTM_GRAFANA_ROOT_URL` to the Grafana URL in `ops/observability/.env` so its links and redirects use it. `tailscale serve --https=3000 off` withdraws it.

- Data persists in the `bb-observability_lgtm-data` volume. `docker compose -f ops/observability/compose.yaml down -v` removes it.
- Point bb at it with `BB_OTLP_ENDPOINT=http://127.0.0.1:4318` in the environment of the server and host daemon, then restart them. In Grafana:
  - Errors from every component: Explore → Loki, `{service_name=~"bb-.+"} | detected_level="error"`.
  - Web app errors: `{service_name="bb-server"} |= "Client error"`.
  - One plugin: `{service_name="bb-server"} | pluginId="<id>"`.
  - Slow or failing requests: Explore → Tempo, service `bb-server`; Prometheus, `http_server_request_duration_seconds_count`.
