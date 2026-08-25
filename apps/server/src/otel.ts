// OpenTelemetry bootstrap for sigiro. Loaded via `node --import ./dist/otel.js`
// (see package.json `start`) so the auto-instrumentations patch http, ws, dns,
// etc. before any application module is evaluated.
//
// Dormant unless SIGIRO_API_KEY is set — local dev, tests and CI stay
// exporter-free with no extra flags.
import { format } from "node:util";

const apiKey = process.env["SIGIRO_API_KEY"];

if (apiKey) {
  // Hosted sigiro terminates OTLP/HTTP on 443; api.sigiro.com:4318 does not
  // answer. Override with SIGIRO_ENDPOINT for a self-hosted collector.
  process.env["OTEL_EXPORTER_OTLP_ENDPOINT"] ??=
    process.env["SIGIRO_ENDPOINT"] ?? "https://api.sigiro.com";
  process.env["OTEL_EXPORTER_OTLP_HEADERS"] ??= `Authorization=Bearer ${apiKey}`;
  process.env["OTEL_SERVICE_NAME"] ??= "ccwarriors-server";
  // Skip the cloud detectors: none of them apply on Railway and the GCP one
  // stalls boot probing a metadata server that is not there.
  process.env["OTEL_NODE_RESOURCE_DETECTORS"] ??= "env,host,os,process,serviceinstance";

  await import("@opentelemetry/auto-instrumentations-node/register");

  // The server logs with console.*, and none of the bundled log bridges cover
  // it (they are pino/winston/bunyan). Forwarding console output into the OTLP
  // logs pipeline here beats swapping the logger across 40 files; drop this for
  // instrumentation-pino if a real logger ever lands.
  const { logs, SeverityNumber } = await import("@opentelemetry/api-logs");
  const logger = logs.getLogger("console");
  const severities = {
    debug: SeverityNumber.DEBUG,
    log: SeverityNumber.INFO,
    info: SeverityNumber.INFO,
    warn: SeverityNumber.WARN,
    error: SeverityNumber.ERROR,
  };
  // Guards the one reentrant path: OTel's own diag logger writes to
  // console.error, so an export failure must not re-enter the emit.
  let emitting = false;
  for (const [level, severityNumber] of Object.entries(severities)) {
    const original = console[level as keyof typeof severities].bind(console);
    (console as unknown as Record<string, unknown>)[level] = (...args: unknown[]) => {
      original(...args);
      if (emitting) return;
      emitting = true;
      try {
        logger.emit({ severityNumber, severityText: level.toUpperCase(), body: format(...args) });
      } finally {
        emitting = false;
      }
    };
  }
}
