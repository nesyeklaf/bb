# Observability

bb writes its logs to rotating files under `<data dir>/logs/` (see [debugging-and-qa.md](debugging-and-qa.md)). Setting `BB_OTLP_ENDPOINT` additionally exports them over OTLP/HTTP to a receiver of your choice, so errors from every component and plugin land in one searchable place.

- Export is off by default. `BB_OTLP_ENDPOINT` takes the receiver's base URL, for example `http://127.0.0.1:4318`; bb appends `/v1/logs`. An empty value turns it off. Only `http` and `https` URLs are accepted.
- The file logs stay the source of truth. The OTLP target is a third pino transport next to the files and the console, at the same `BB_LOG_LEVEL`. A receiver that is down drops records; it never blocks or fails bb.
- Each component reports as its own service: `bb-server`, `bb-host-daemon`, and so on, with `service.version` from the bb version. Log fields become record attributes. Plugin lines carry `pluginId` as a field, so one plugin's output can be filtered without parsing the `[plugin:<id>]` prefix.
- The standard `OTEL_*` variables still tune the exporter, for example `OTEL_EXPORTER_OTLP_HEADERS` for a hosted receiver or `OTEL_BLRP_SCHEDULE_DELAY` for the batch interval. bb does not read `OTEL_EXPORTER_OTLP_ENDPOINT` itself, so a value meant for an agent's own tooling never turns on bb's export.

## Local collector

`ops/observability/compose.yaml` runs [grafana/otel-lgtm](https://github.com/grafana/docker-otel-lgtm): an OpenTelemetry Collector with Loki, Tempo, Prometheus and Grafana in one container.

```sh
docker compose -f ops/observability/compose.yaml up -d
```

- Every port binds to `127.0.0.1` only: Grafana on `3000`, OTLP gRPC on `4317`, OTLP HTTP on `4318`. Override them with `BB_LGTM_GRAFANA_PORT`, `BB_LGTM_OTLP_GRPC_PORT` and `BB_LGTM_OTLP_HTTP_PORT`. From another machine, tunnel: `ssh -L 3000:127.0.0.1:3000 <host>`.
- Grafana allows anonymous admin access, which is why it must stay on loopback. Its usage reporting and update checks are turned off; at first start it still downloads its Drilldown apps from grafana.com.
- Data persists in the `bb-observability_lgtm-data` volume. `docker compose -f ops/observability/compose.yaml down -v` removes it.
- Point bb at it with `BB_OTLP_ENDPOINT=http://127.0.0.1:4318` in the environment of the server and host daemon, then restart them. In Grafana, Explore → Loki, query `{service_name="bb-server"}` or `{service_name=~"bb-.+"} | detected_level="error"`.
