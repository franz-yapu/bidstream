import { describe, expect, it } from 'vitest';
import { loadKafkaConfig, toLibrdkafkaConfig } from './config.js';
import { CONSUMER_GROUPS, TOPICS } from './topics.js';

describe('loadKafkaConfig', () => {
  it('usa Kafka local sin seguridad por defecto', () => {
    expect(loadKafkaConfig({})).toEqual({
      brokers: ['localhost:9092'],
      clientId: 'bidstream',
      securityProtocol: 'PLAINTEXT',
    });
  });
  it('acepta varios brokers y limpia espacios', () => {
    expect(loadKafkaConfig({ KAFKA_BROKERS: 'a:9092, b:9092 ,' }).brokers).toEqual([
      'a:9092',
      'b:9092',
    ]);
  });
  it('SASL_SSL exige usuario y contraseña', () => {
    expect(() => loadKafkaConfig({ KAFKA_SECURITY_PROTOCOL: 'SASL_SSL' })).toThrow();
    expect(() =>
      loadKafkaConfig({ KAFKA_SECURITY_PROTOCOL: 'SASL_SSL', KAFKA_SASL_USERNAME: 'u' }),
    ).toThrow();
  });
  it('rechaza un protocolo desconocido', () => {
    expect(() => loadKafkaConfig({ KAFKA_SECURITY_PROTOCOL: 'SSL' })).toThrow();
  });
});

describe('toLibrdkafkaConfig', () => {
  it('local: texto plano', () => {
    expect(toLibrdkafkaConfig(loadKafkaConfig({}))).toEqual({
      'bootstrap.servers': 'localhost:9092',
      'client.id': 'bidstream',
      'security.protocol': 'plaintext',
    });
  });
  it('Event Hubs: SASL_SSL con mecanismo PLAIN, sin cambiar de código', () => {
    const cfg = toLibrdkafkaConfig(
      loadKafkaConfig({
        KAFKA_BROKERS: 'ns.servicebus.windows.net:9093',
        KAFKA_SECURITY_PROTOCOL: 'SASL_SSL',
        KAFKA_SASL_USERNAME: '$ConnectionString',
        KAFKA_SASL_PASSWORD: 'Endpoint=sb://ns/;SharedAccessKey=x',
      }),
    );
    expect(cfg).toMatchObject({
      'bootstrap.servers': 'ns.servicebus.windows.net:9093',
      'security.protocol': 'sasl_ssl',
      'sasl.mechanism': 'PLAIN',
      'sasl.username': '$ConnectionString',
    });
  });
});

describe('topics y grupos', () => {
  it('coinciden con la spec §4', () => {
    expect(TOPICS).toEqual({
      commandsBid: 'bidstream.commands.bid',
      eventsLot: 'bidstream.events.lot',
      eventsLotDlq: 'bidstream.events.lot.dlq',
    });
    expect(Object.values(CONSUMER_GROUPS)).toEqual(['projector', 'notifier', 'auditor']);
  });
});
