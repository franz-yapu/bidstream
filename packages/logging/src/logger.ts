import { redact, serializeError } from './redact.js';

export type LogLevel = 'debug' | 'info' | 'warn' | 'error';

/** Contrato mínimo que usan relay, consumidores y notifier. */
export interface Logger {
  info(fields: Record<string, unknown>, message: string): void;
  warn(fields: Record<string, unknown>, message: string): void;
  error(fields: Record<string, unknown>, message: string): void;
}

export interface ContextLogger extends Logger {
  debug(fields: Record<string, unknown>, message: string): void;
  /** Logger que añade `context` a cada línea; no modifica al padre. */
  child(context: Record<string, unknown>): ContextLogger;
}

export interface LoggerOptions {
  readonly service: string;
  readonly level?: LogLevel;
  /** Recibe la línea JSON ya serializada (sin salto de línea). Por defecto, `console.log`. */
  readonly write?: (line: string) => void;
  readonly now?: () => Date;
}

const ORDER: Record<LogLevel, number> = { debug: 10, info: 20, warn: 30, error: 40 };

/**
 * Logger JSON de una línea por evento, con redacción de secretos. Los campos reservados
 * (`level`, `time`, `service`, `msg`) no se pueden sobrescribir desde el contexto.
 */
export function createLogger(
  options: LoggerOptions,
  context: Record<string, unknown> = {},
): ContextLogger {
  const threshold = ORDER[options.level ?? 'info'];
  const write =
    options.write ??
    ((line: string) => {
      console.log(line);
    });
  const now = options.now ?? (() => new Date());

  const emit = (level: LogLevel, fields: Record<string, unknown>, message: string): void => {
    if (ORDER[level] < threshold) return;
    const { err, ...rest } = { ...context, ...fields };
    const safe = redact(rest) as Record<string, unknown>;
    write(
      JSON.stringify({
        ...safe,
        ...(err === undefined ? {} : { error: serializeError(err, level === 'error') }),
        level,
        time: now().toISOString(),
        service: options.service,
        msg: message,
      }),
    );
  };

  return {
    debug: (fields, message) => {
      emit('debug', fields, message);
    },
    info: (fields, message) => {
      emit('info', fields, message);
    },
    warn: (fields, message) => {
      emit('warn', fields, message);
    },
    error: (fields, message) => {
      emit('error', fields, message);
    },
    child: (extra) => createLogger(options, { ...context, ...extra }),
  };
}

/** Lee `LOG_LEVEL` del entorno; un valor desconocido cae a `info`. */
export function levelFromEnv(value: string | undefined): LogLevel {
  return value === 'debug' || value === 'info' || value === 'warn' || value === 'error'
    ? value
    : 'info';
}
