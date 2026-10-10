/**
 * OpenTelemetry preload — single entry point for SDK setup.
 *
 * Loaded via `tsx --import ./instrumentation.ts`, runs BEFORE any application
 * module is evaluated. By starting NodeSDK here:
 *   - require-in-the-middle hooks for http / pg / ioredis install before app
 *     code does `require('pg')` etc. (fixes the original commit-9451cd7c race).
 *   - The MeterProvider is real from the moment instrumentations construct, so
 *     `this._meter` is never NoopMeter — no setMeterProvider rebind dance.
 *
 * Trade-offs accepted:
 *   - Env vars are read directly from `process.env` (no valibot). The full
 *     business `Env` schema is parsed later in libs/env.ts; this preload only
 *     needs OTEL_* — and a config error here should crash early anyway.
 *   - `dotenvx run` injects .env.local before tsx, so process.env is fully
 *     populated by the time this file runs.
 *
 * Sources / why this shape:
 *   - https://opentelemetry.io/docs/languages/js/getting-started/nodejs/
 *   - https://github.com/open-telemetry/opentelemetry-js-contrib/blob/main/packages/auto-instrumentations-node/src/register.ts
 *   - https://github.com/open-telemetry/opentelemetry-js/issues/3146 (NodeSDK
 *     registers instrumentations early in start(), making single-file safe)
 */

import process, { env, exit } from 'node:process'

import { randomUUID } from 'node:crypto'

import { diag, DiagConsoleLogger, DiagLogLevel } from '@opentelemetry/api'
import { OTLPLogExporter } from '@opentelemetry/exporter-logs-otlp-proto'
import { OTLPMetricExporter } from '@opentelemetry/exporter-metrics-otlp-proto'
import { OTLPTraceExporter } from '@opentelemetry/exporter-trace-otlp-proto'
import { HttpInstrumentation } from '@opentelemetry/instrumentation-http'
import { IORedisInstrumentation } from '@opentelemetry/instrumentation-ioredis'
import { PgInstrumentation } from '@opentelemetry/instrumentation-pg'
import { RuntimeNodeInstrumentation } from '@opentelemetry/instrumentation-runtime-node'
import { UndiciInstrumentation } from '@opentelemetry/instrumentation-undici'
import { resourceFromAttributes } from '@opentelemetry/resources'
import { BatchLogRecordProcessor } from '@opentelemetry/sdk-logs'
import { PeriodicExportingMetricReader } from '@opentelemetry/sdk-metrics'
import { NodeSDK } from '@opentelemetry/sdk-node'
import { BatchSpanProcessor, ParentBasedSampler, TraceIdRatioBasedSampler } from '@opentelemetry/sdk-trace-node'
import { ATTR_SERVICE_NAME, ATTR_SERVICE_VERSION } from '@opentelemetry/semantic-conventions'

// NOTICE:
// Set stable HTTP semantics before HttpInstrumentation reads the environment.
// Grafana expects http.server.request.duration in seconds, not the old millisecond metric.
// Empty Railway values also select stable semantics.
// Source: instrumentation-http >=0.215 constructor.
// Remove this override when stable semantics become its default.
if (!env.OTEL_SEMCONV_STABILITY_OPT_IN)
  env.OTEL_SEMCONV_STABILITY_OPT_IN = 'http'

// Surface the resolved value early. Lets ops grep Railway logs for
// `[otel-preload]` to confirm the preload actually executed and what semconv
// mode is active. Without this, a misloaded preload (wrong --import path,
// missing flag, build cache) is invisible.
console.info(`[otel-preload] OTEL_SEMCONV_STABILITY_OPT_IN=${env.OTEL_SEMCONV_STABILITY_OPT_IN}`)

const otlpEndpoint = env.OTEL_EXPORTER_OTLP_ENDPOINT
if (!otlpEndpoint) {
  console.info('[otel-preload] OpenTelemetry disabled (set OTEL_EXPORTER_OTLP_ENDPOINT to enable)')
}
else {
  if (env.OTEL_DEBUG === 'true')
    diag.setLogger(new DiagConsoleLogger(), DiagLogLevel.DEBUG)

  // OTEL_EXPORTER_OTLP_HEADERS format: "key=value,key2=value2"
  const headers: Record<string, string> = {}
  for (const pair of (env.OTEL_EXPORTER_OTLP_HEADERS ?? '').split(',')) {
    const idx = pair.indexOf('=')
    if (idx > 0)
      headers[pair.slice(0, idx).trim()] = pair.slice(idx + 1).trim()
  }

  const serviceName = env.OTEL_SERVICE_NAME || 'server'
  const serviceNamespace = env.OTEL_SERVICE_NAMESPACE || 'airi'
  const samplingRatioRaw = Number(env.OTEL_TRACES_SAMPLING_RATIO ?? '1')
  // Head-based sampling. Metrics are always 100% accurate regardless.
  const samplingRatio = Number.isFinite(samplingRatioRaw) && samplingRatioRaw >= 0 && samplingRatioRaw <= 1
    ? samplingRatioRaw
    : 1

  // Each replica needs a unique service.instance.id to prevent dropped or merged Prometheus samples.
  // Prefer RAILWAY_REPLICA_ID, then SERVER_INSTANCE_ID, then a per-process UUID.
  // The UUID changes after restarts and increases temporary series cardinality.
  // Railway does not document HOSTNAME as replica-unique. Set SERVER_INSTANCE_ID for restart stability.
  let instanceId = env.RAILWAY_REPLICA_ID || env.SERVER_INSTANCE_ID
  if (!instanceId) {
    instanceId = randomUUID()
    console.warn(`[otel-preload] No RAILWAY_REPLICA_ID or SERVER_INSTANCE_ID set — falling back to randomUUID() ${instanceId}. Multi-replica metric series will churn on every restart.`)
  }

  const resource = resourceFromAttributes({
    [ATTR_SERVICE_NAME]: serviceName,
    [ATTR_SERVICE_VERSION]: env.npm_package_version || '0.0.0',
    'deployment.environment': env.NODE_ENV || 'development',
    'service.instance.id': instanceId,
    'service.namespace': serviceNamespace,
  })

  const sdk = new NodeSDK({
    resource,
    sampler: new ParentBasedSampler({
      root: new TraceIdRatioBasedSampler(samplingRatio),
    }),
    spanProcessors: [new BatchSpanProcessor(new OTLPTraceExporter({
      headers,
      url: `${otlpEndpoint}/v1/traces`,
    }))],
    logRecordProcessors: [new BatchLogRecordProcessor({
      exporter: new OTLPLogExporter({ headers, url: `${otlpEndpoint}/v1/logs` }),
    })],
    metricReaders: [new PeriodicExportingMetricReader({
      exporter: new OTLPMetricExporter({ headers, url: `${otlpEndpoint}/v1/metrics` }),
      exportIntervalMillis: 15_000,
      exportTimeoutMillis: 10_000,
    })],
    instrumentations: [
      // Inbound HTTP is instrumented by @hono/otel inside the Hono pipeline
      // (it sees Hono's matched route pattern; auto-instrumentation can't).
      // Keep HttpInstrumentation for OUTBOUND traces only — LLM gateway,
      // Stripe, Resend, OIDC discovery — so we still get spans on egress.
      new HttpInstrumentation({
        // NOTICE:
        // Do not use `ignoreIncomingRequestHook: () => true` here. In
        // @opentelemetry/instrumentation-http@0.215.0, ignored incoming
        // requests run the whole Node `request` listener inside
        // `suppressTracing(...)`, which also suppresses @hono/otel middleware
        // spans and hand-written route spans. Disabling incoming patching keeps
        // outbound http/https spans without touching Hono's request context.
        disableIncomingRequestInstrumentation: true,
      }),
      new PgInstrumentation({
        enhancedDatabaseReporting: true,
      }),
      new IORedisInstrumentation(),
      new RuntimeNodeInstrumentation(),
      // Outbound fetch — HttpInstrumentation only patches node:http/https, not undici.
      new UndiciInstrumentation(),
    ],
  })

  sdk.start()
  console.info(`[otel-preload] OpenTelemetry initialized — OTLP: ${otlpEndpoint}, sampling ratio: ${samplingRatio}`)

  // Graceful shutdown — flush pending exports before exit. Idempotent.
  let shuttingDown = false
  const shutdown = async () => {
    if (shuttingDown)
      return
    shuttingDown = true
    try {
      await sdk.shutdown()
      console.info('[otel-preload] OpenTelemetry shut down successfully')
    }
    catch (err) {
      console.error('[otel-preload] Error shutting down OpenTelemetry:', err)
    }
  }
  const shutdownAndExit = () => {
    void shutdown().then(() => exit(0))
  }
  process.on('SIGTERM', shutdownAndExit)
  process.on('SIGINT', shutdownAndExit)
}
