import { KafkaJS } from '@confluentinc/kafka-javascript';
import { toLibrdkafkaConfig, type KafkaConfig } from './config.js';

/** Instancia del cliente; la única diferencia local ↔ Event Hubs son las variables de entorno. */
export function createKafka(config: KafkaConfig): KafkaJS.Kafka {
  return new KafkaJS.Kafka(toLibrdkafkaConfig(config));
}
