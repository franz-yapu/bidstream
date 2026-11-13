import { KafkaJS } from '@confluentinc/kafka-javascript';
import { toLibrdkafkaConfig, type KafkaConfig } from './config.js';

const LOG_LEVELS = {
  nothing: KafkaJS.logLevel.NOTHING,
  error: KafkaJS.logLevel.ERROR,
  warn: KafkaJS.logLevel.WARN,
  info: KafkaJS.logLevel.INFO,
  debug: KafkaJS.logLevel.DEBUG,
} as const;

/** Instancia del cliente; la única diferencia local ↔ Event Hubs son las variables de entorno. */
export function createKafka(config: KafkaConfig): KafkaJS.Kafka {
  const flat = toLibrdkafkaConfig(config);
  return new KafkaJS.Kafka(
    config.logLevel === undefined
      ? flat
      : {
          ...flat,
          kafkaJS: { brokers: [...config.brokers], logLevel: LOG_LEVELS[config.logLevel] },
        },
  );
}
