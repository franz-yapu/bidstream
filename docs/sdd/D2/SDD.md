# SDD — D2 · Cliente Kafka compartido (local y Event Hubs)

- **Ticket:** ClickUp **D2** (`868mvty03`, https://app.clickup.com/t/868mvty03).
- **Autor:** generado con Claude (Entregable 1).
- **Estado:** Borrador
- **Versión:** 1.0 · **Fecha:** 2026-11-12
- **Fuentes de verdad citadas:**
  1. `docs/product/bidstream_spec.md` §9 (Event Hubs expone un endpoint compatible con el protocolo Kafka; el mismo código corre contra Kafka local y Azure), §4 (topics, grupos), §5 (al menos una vez)
  2. `docs/sdd/0.2/SDD.md` §2.1 (listeners `localhost:9092` y `kafka:19092`, topics creados)
  3. `docs/adr/0001-clave-de-particion-lotid.md` (la clave del mensaje es `lotId`/`auctionId`)
  4. `docs/sdd/A2/SDD.md` (`partitionKey`, contrato de eventos)
  5. `docs/do-not-touch.md` — dominio sin infraestructura

---

## 0 · Preguntas que el ticket pidió cerrar

| # | Pregunta del ticket | Respuesta |
|---|---|---|
| 1 | ¿Qué librería de Kafka y por qué? | **`@confluentinc/kafka-javascript`** (§2.1); alternativa descrita en §7 #1 |

---

## 1 · Alcance

### Entra

- Workspace `packages/kafka` (`@bidstream/kafka`) con una fábrica de productor y de consumidor.
- Configuración por entorno validada con Zod: modo local (`PLAINTEXT`) y modo Event Hubs (`SASL_SSL` + `PLAIN`), **sin cambiar código** entre uno y otro.
- Constantes de topics y grupos de consumidores.
- Productor con entrega fiable (idempotente, `acks=all`); consumidor con *commit* manual de offsets.
- Pruebas contra el Kafka real de `make up`.

### No entra (a propósito)

- Relay de outbox (D1), mecánica de reintentos/DLQ/idempotencia (D3) y consumidores (D4–D6): usan este paquete.
- Aprovisionamiento de Event Hubs y secretos reales → H1 (Q1).
- Serialización con *schema registry*: el valor es el JSON del evento ya validado con `parseEvent`.
- Métricas de consumer lag → H4.

### Premisas verificadas (heredadas de `task-brief`)

| Premisa del ticket | Qué hay de verdad |
|---|---|
| "Sin cambiar código entre local y Event Hubs" | Solo es cierto si se parametriza por entorno el protocolo de seguridad y las credenciales; local usa `PLAINTEXT` en `localhost:9092`/`kafka:19092`, Event Hubs `SASL_SSL` en `<namespace>.servicebus.windows.net:9093` con usuario `$ConnectionString` |
| Librería | `kafkajs` 2.2.4 **no recibe cambios desde febrero de 2023**; `@confluentinc/kafka-javascript` 1.11.0 (oct. 2026) es mantenida, basada en librdkafka y ofrece una API compatible con kafkajs; `@platformatic/kafka` 2.15.0 (nov. 2026) es JS puro, exige Node `>=22.22` |
| Binarios nativos | `@confluentinc/kafka-javascript` descarga un binario precompilado en la instalación (`node-pre-gyp`); hay que comprobar que existe para la imagen base de H2 |
| Entorno local | `make up` ya deja Kafka y los 3 topics; `KAFKA_BROKERS=localhost:9092` está en `.env.example` |

---

## 2 · Diseño técnico

### 2.1 Decisiones y por qué

| Decisión | Elección | Por qué |
|---|---|---|
| Librería | **`@confluentinc/kafka-javascript`** (API `KafkaJS` promisificada) | Mantenida, basada en librdkafka (la implementación de referencia, también la que recomienda Microsoft para Event Hubs), idempotencia y `acks=all` completos. `kafkajs` está abandonada. `@platformatic/kafka` es válida y sin binarios, pero más nueva y menos probada frente a Event Hubs |
| Fiabilidad del productor | `enable.idempotence=true`, `acks=all`, reintentos | Evita duplicados por reintentos de red; con el relay (D1) da *al menos una vez* sin duplicados del productor. El consumidor sigue necesitando idempotencia por `eventId` (spec §5) |
| Clave y valor | Clave = `partitionKey(event)` (string); valor = JSON del evento; cabeceras: `eventId`, `type`, `version` | ADR-0001; las cabeceras permiten enrutar y diagnosticar sin parsear el valor |
| Consumidor | Grupo configurable, `auto.offset.reset=earliest`, **commit manual** tras procesar | Necesario para reintentos y reproceso desde el principio (spec §5) |
| Seguridad | `KAFKA_SECURITY_PROTOCOL` = `PLAINTEXT` \| `SASL_SSL`; `KAFKA_SASL_USERNAME`/`KAFKA_SASL_PASSWORD` solo en `SASL_SSL` | Mismo código local y en Azure; el secreto sale de variables de entorno (Key Vault → Container Apps, H1) |
| Validación de config | Zod; con `SASL_SSL` exige usuario y contraseña | Falla al arrancar, no al primer mensaje |
| Topics | `TOPICS` y `CONSUMER_GROUPS` como constantes tipadas | Una sola fuente de nombres; evita *typos* (la auto-creación está desactivada) |
| API del paquete | Interfaces propias `KafkaProducer` / `KafkaConsumer` pequeñas | Aísla la librería: cambiarla (p. ej. a Platformatic) toca solo este paquete |
| Ubicación | `packages/kafka`; no en el dominio | Infraestructura, no puede importarse desde `packages/domain` |

### 2.2 Variables de entorno

| Variable | Local | Event Hubs |
|---|---|---|
| `KAFKA_BROKERS` | `localhost:9092` | `<ns>.servicebus.windows.net:9093` |
| `KAFKA_SECURITY_PROTOCOL` | `PLAINTEXT` (defecto) | `SASL_SSL` |
| `KAFKA_SASL_USERNAME` | — | `$ConnectionString` |
| `KAFKA_SASL_PASSWORD` | — | cadena de conexión (secreto) |
| `KAFKA_CLIENT_ID` | `bidstream-<proceso>` | igual |

### 2.3 API del paquete

```ts
loadKafkaConfig(env): KafkaConfig
createProducer(config): Promise<KafkaProducer>
  producer.publish(topic, { key, value, headers? }): Promise<void>
  producer.publishEvent(event: DomainEvent): Promise<void>   // topic de eventos, clave = partitionKey
  producer.disconnect()
createConsumer(config, { groupId, topics }): Promise<KafkaConsumer>
  consumer.run(handler: (msg: { topic, partition, offset, key, value, headers }) => Promise<void>)
  // el consumidor confirma el offset solo cuando el handler resuelve
  consumer.disconnect()
TOPICS = { commandsBid, eventsLot, eventsLotDlq }
CONSUMER_GROUPS = { projector, notifier, auditor }
```

### 2.4 Plan de verificación inicial (*spike*)

Antes de escribir el resto: instalar la librería en `node:22` (glibc y slim) y comprobar que el binario precompilado se descarga y que un productor/consumidor funciona contra `make up`. Si falla, se aplica la alternativa de §7 #1 y se anota en el changelog.

---

## 3 · Cambios por archivo/módulo

| Archivo/módulo | Cambio |
|---|---|
| `packages/kafka/package.json` | Nuevo `@bidstream/kafka`: `@confluentinc/kafka-javascript`, `zod`, `@bidstream/domain` |
| `packages/kafka/tsconfig*.json`, `tsconfig.json` (raíz) | Nuevo paquete y referencia |
| `packages/kafka/src/config.ts` | `loadKafkaConfig` con Zod |
| `packages/kafka/src/topics.ts` | `TOPICS`, `CONSUMER_GROUPS` |
| `packages/kafka/src/producer.ts` | `createProducer`, `publish`, `publishEvent` |
| `packages/kafka/src/consumer.ts` | `createConsumer`, `run` con commit manual |
| `packages/kafka/src/index.ts` | Reexporta la API pública |
| `packages/kafka/src/*.test.ts` | Unit (config) e integración (`*.int.test.ts`) |
| `.env.example` | `KAFKA_SECURITY_PROTOCOL`, `KAFKA_CLIENT_ID` y comentarios para Event Hubs |
| `package.json` (raíz), `vitest.config.ts` | `test:integration` separado de `test` (compartido con B1) |
| `docs/decisions/LOG.md` | Registrar la librería elegida y el resultado del *spike* |

---

## 4 · Plan de tests

| Caso | Nivel | Cubre |
|---|---|---|
| `loadKafkaConfig`: local por defecto; `SASL_SSL` sin usuario/contraseña falla; protocolo desconocido falla | unit | Configuración |
| El modo `SASL_SSL` produce la configuración de librdkafka esperada (`sasl.mechanism=PLAIN`, `security.protocol=SASL_SSL`) | unit | Sin cambiar código para Azure |
| `publishEvent` publica en `bidstream.events.lot` con clave = `partitionKey` y cabeceras `eventId`/`type`/`version` | integración (Kafka real) | Contrato del mensaje |
| Dos eventos del mismo `lotId` caen en la misma partición y el consumidor los recibe en orden | integración | ADR-0001 |
| El consumidor no confirma el offset si el handler lanza; al reiniciar vuelve a recibir el mensaje | integración | Commit manual / al menos una vez |
| Un grupo nuevo con `earliest` recibe el historial completo | integración | Base del reproceso (G2) |
| Dos grupos distintos leen el mismo topic de forma independiente | integración | `projector`/`notifier`/`auditor` |
| Publicar en un topic inexistente falla con error claro | integración | Auto-creación desactivada |
| El paquete no se importa desde `packages/domain` (regla de pureza) | lint | Capas |

**Deliberadamente sin test:** conexión real a Azure Event Hubs (cuesta dinero y requiere Q1; se valida en H1 con la misma configuración); rendimiento.

---

## 5 · Definition of Done

- [ ] SDD en `docs/sdd/D2/SDD.md`, Estado = Aprobado
- [ ] *Spike* de §2.4 hecho y resultado registrado
- [ ] Productor y consumidor funcionan contra `make up` con el mismo código que usará Event Hubs (solo cambian variables de entorno)
- [ ] Tests del §4 en verde; `npm run check` en verde
- [ ] Librería elegida y su justificación en `LOG.md`
- [ ] PR con CI verde y fusionado

---

## 6 · Riesgos

| Riesgo | Gravedad | Mitigación |
|---|---|---|
| El binario nativo no existe para la imagen de H2 (p. ej. Alpine) o no se descarga en la CI | Media | *Spike* temprano (§2.4); usar imagen `node:22-slim`; si falla, `@platformatic/kafka` (§7 #1) |
| Event Hubs Kafka no soporta alguna característica usada (idempotencia, transacciones) según el nivel | Media | Verificar los requisitos del nivel de servicio en H1; este paquete no usa transacciones de Kafka |
| La capa propia `KafkaProducer`/`KafkaConsumer` oculta opciones útiles | Baja | API mínima y ampliable bajo demanda |
| Confundir "al menos una vez" con "exactamente una vez" | Media | Documentado: la idempotencia por `eventId` es responsabilidad del consumidor (D3) |

---

## 7 · Preguntas abiertas

1. **Librería:** ¿`@confluentinc/kafka-javascript` (propuesta) o `@platformatic/kafka` (JS puro, sin binarios)? Si prefieres evitar el binario nativo, la segunda es la opción; el resto del SDD no cambia gracias a la capa propia.
2. ¿El valor del mensaje va como JSON simple (propuesta) o con una cabecera de versión de esquema además de `version` en el sobre? Propuesta: JSON simple, `version` ya viaja en el evento.
3. ¿Se publica `bidstream.commands.bid` con este mismo paquete? Depende de Q2 (autoridad de la puja); por ahora `TOPICS.commandsBid` solo se define.
