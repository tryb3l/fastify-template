'use strict'

require('dotenv').config()
const packageJson = require('../package.json')

const { NodeTracerProvider } = require('@opentelemetry/sdk-trace-node')
const { SemanticResourceAttributes } = require('@opentelemetry/semantic-conventions')
const { Resource } = require('@opentelemetry/resources')
const { ParentBasedSampler, TraceIdRatioBasedSampler } = require('@opentelemetry/sdk-trace-base')
const { registerInstrumentations } = require('@opentelemetry/instrumentation')
const { DnsInstrumentation } = require('@opentelemetry/instrumentation-dns')
const { HttpInstrumentation } = require('@opentelemetry/instrumentation-http')
const { FastifyInstrumentation } = require('@opentelemetry/instrumentation-fastify')
const { MongoDBInstrumentation } = require('@opentelemetry/instrumentation-mongodb')
const { BatchSpanProcessor } = require('@opentelemetry/sdk-trace-base')
const { ZipkinExporter } = require('@opentelemetry/exporter-zipkin')

// Read configuration from environment variables
const ZIPKIN_URL = process.env.ZIPKIN_URL || 'http://localhost:9411/api/v2/spans'
// Default to 100% locally, but 5% (0.05) in production
const TRACE_RATIO = parseFloat(process.env.TRACE_RATIO) || (process.env.NODE_ENV === 'production' ? 0.05 : 1)

if (process.env.ENABLE_TRACING === 'true') {
  const sdk = new NodeTracerProvider({
    sampler: new ParentBasedSampler({
      root: new TraceIdRatioBasedSampler(TRACE_RATIO),
    }),
    resource: new Resource({
      [SemanticResourceAttributes.DEPLOYMENT_ENVIRONMENT]: process.env.NODE_ENV || 'development',
      [SemanticResourceAttributes.SERVICE_NAME]: packageJson.name,
      [SemanticResourceAttributes.SERVICE_VERSION]: packageJson.version,
    }),
  })

  registerInstrumentations({
    tracerProvider: sdk,
    instrumentations: [
      new DnsInstrumentation(),
      new HttpInstrumentation(),
      new FastifyInstrumentation(),
      new MongoDBInstrumentation(),
    ],
  })

  const exporter = new ZipkinExporter({
    url: ZIPKIN_URL,
  })

  sdk.addSpanProcessor(new BatchSpanProcessor(exporter))
  sdk.register()

  process.stdout.write(`[Telemetry] OpenTelemetry SDK started (Ratio: ${TRACE_RATIO})\n`)
}