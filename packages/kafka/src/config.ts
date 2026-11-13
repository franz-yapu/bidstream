import { z } from 'zod';

const envSchema = z
  .object({
    KAFKA_BROKERS: z.string().min(1).default('localhost:9092'),
    KAFKA_SECURITY_PROTOCOL: z.enum(['PLAINTEXT', 'SASL_SSL']).default('PLAINTEXT'),
    KAFKA_SASL_USERNAME: z.string().min(1).optional(),
    KAFKA_SASL_PASSWORD: z.string().min(1).optional(),
    KAFKA_CLIENT_ID: z.string().min(1).default('bidstream'),
    /** Ruido del propio cliente (conexiones, rebalanceos); `error` en demostraciones. */
    KAFKA_LOG_LEVEL: z.enum(['nothing', 'error', 'warn', 'info', 'debug']).optional(),
  })
  .superRefine((env, ctx) => {
    if (env.KAFKA_SECURITY_PROTOCOL !== 'SASL_SSL') return;
    for (const key of ['KAFKA_SASL_USERNAME', 'KAFKA_SASL_PASSWORD'] as const) {
      if (env[key] === undefined) {
        ctx.addIssue({
          code: 'custom',
          path: [key],
          message: `${key} es obligatorio con SASL_SSL`,
        });
      }
    }
  });

export interface KafkaConfig {
  readonly brokers: readonly string[];
  readonly clientId: string;
  readonly securityProtocol: 'PLAINTEXT' | 'SASL_SSL';
  readonly sasl?: { readonly username: string; readonly password: string };
  /** Nivel de log del cliente; si falta, el predeterminado de la librería. */
  readonly logLevel?: 'nothing' | 'error' | 'warn' | 'info' | 'debug';
}

/**
 * Lee la configuración del entorno. Local: `PLAINTEXT` en `localhost:9092`. Event Hubs:
 * `SASL_SSL` con usuario `$ConnectionString` y la cadena de conexión como contraseña. El código
 * que usa el cliente es el mismo en ambos casos (spec §9).
 */
export function loadKafkaConfig(env: Readonly<Record<string, string | undefined>>): KafkaConfig {
  const parsed = envSchema.parse(env);
  const base = {
    brokers: parsed.KAFKA_BROKERS.split(',')
      .map((b) => b.trim())
      .filter((b) => b.length > 0),
    clientId: parsed.KAFKA_CLIENT_ID,
    securityProtocol: parsed.KAFKA_SECURITY_PROTOCOL,
    ...(parsed.KAFKA_LOG_LEVEL === undefined ? {} : { logLevel: parsed.KAFKA_LOG_LEVEL }),
  };
  if (
    parsed.KAFKA_SECURITY_PROTOCOL === 'SASL_SSL' &&
    parsed.KAFKA_SASL_USERNAME !== undefined &&
    parsed.KAFKA_SASL_PASSWORD !== undefined
  ) {
    return {
      ...base,
      sasl: { username: parsed.KAFKA_SASL_USERNAME, password: parsed.KAFKA_SASL_PASSWORD },
    };
  }
  return base;
}

/** Opciones de librdkafka derivadas de la configuración (la única diferencia local ↔ Azure). */
export function toLibrdkafkaConfig(config: KafkaConfig): Record<string, string | number | boolean> {
  const out: Record<string, string | number | boolean> = {
    'bootstrap.servers': config.brokers.join(','),
    'client.id': config.clientId,
    'security.protocol': config.securityProtocol.toLowerCase(),
  };
  if (config.sasl !== undefined) {
    out['security.protocol'] = 'sasl_ssl';
    out['sasl.mechanism'] = 'PLAIN';
    out['sasl.username'] = config.sasl.username;
    out['sasl.password'] = config.sasl.password;
  }
  return out;
}
