# SDD — 0.2 · docker-compose con Kafka KRaft + PostgreSQL y `make up`

- **Ticket:** ClickUp **0.2** (`868mvtfpc`, https://app.clickup.com/t/868mvtfpc).
- **Autor:** generado con Claude (Entregable 1).
- **Estado:** Implementado (2026-11-12) — aprobado el mismo día
- **Versión:** 1.0 · **Fecha:** 2026-11-12
- **Fuentes de verdad citadas:**
  1. `docs/product/bidstream_spec.md` §4 (topics, particiones, retención), §9 (local: docker-compose, Kafka KRaft sin Zookeeper, PostgreSQL, un solo `make up`)
  2. `docs/adr/0001-clave-de-particion-lotid.md` (6 particiones, clave `lotId`)
  3. `docs/do-not-touch.md` — "Log de eventos como fuente de verdad (retención ilimitada)"
  4. `docs/decisions/LOG.md` — DEC-004 (npm)

---

## 1 · Alcance

### Entra

- `docker-compose.yml` con **Kafka en modo KRaft** (un solo nodo, broker + controller) y **PostgreSQL**.
- Servicio de un solo uso `kafka-init` que crea los 3 topics de la spec §4 de forma idempotente.
- `Makefile` con `up`, `down`, `ps`, `logs`, `topics`, `psql`, `reset`.
- `.env.example` con puertos y credenciales de desarrollo.
- Healthchecks, para que `make up` solo termine cuando todo esté listo.

### No entra (a propósito)

- Esquema de base de datos y migraciones → B1.
- UI de Kafka (Kafka UI/Redpanda Console) y Grafana/Prometheus → H4 y opcional después.
- Contenedores de las apps (api, relay, consumidores) → H2.
- Seguridad de Kafka local (SASL/TLS): solo desarrollo; contra Event Hubs lo cubre D2/H1.
- Clúster multi-broker.

### Premisas verificadas (heredadas de `task-brief`)

| Premisa del ticket | Qué hay de verdad |
|---|---|
| "`make up` deja Kafka y PostgreSQL listos" | No existe `docker-compose.yml` ni `Makefile`. Máquina de desarrollo: Docker 27.2.0, Compose v2.29.2, GNU Make 4.3 |
| Puertos libres | 5432 y 9092 libres hoy en la máquina (se hacen configurables por si otro proyecto los ocupa) |
| PostgreSQL | Ya hay `postgres:16-alpine` en local; Azure Database for PostgreSQL Flexible Server soporta 16 |
| Topics de §4 | `commands.bid` 6 part./7 d; `events.lot` 6 part./retención ilimitada; `events.lot.dlq` 1 part./30 d |

---

## 2 · Diseño técnico

### 2.1 Decisiones y por qué

| Decisión | Elección | Por qué |
|---|---|---|
| Imagen de Kafka | `apache/kafka` (imagen oficial de Apache, KRaft nativo), versión **fijada** a una etiqueta estable concreta al implementar (se verifica que se descarga y arranca) | Sin Zookeeper, oficial y sin licencia propietaria. Fijar versión evita que `latest` rompa el entorno |
| PostgreSQL | `postgres:16-alpine` | Mismo major que usará Azure Flexible Server; ya está en la máquina |
| Nodos | 1 broker que es también controller | Suficiente para desarrollo; `replication.factor=1`, `min.insync.replicas=1` |
| Listeners | `INTERNAL` (`kafka:19092`, para contenedores) y `EXTERNAL` (`localhost:${KAFKA_PORT:-9092}`, para apps en el host) | Las apps corren en el host en desarrollo; los contenedores (init, futuras apps) usan el nombre de servicio. Un solo listener rompería una de las dos rutas |
| Creación de topics | Servicio `kafka-init` con `kafka-topics.sh --create --if-not-exists`, `restart: "no"`, `depends_on: kafka (healthy)` | Idempotente y repetible; los topics son parte del entorno, no del código de la app |
| Retención | `events.lot`: `retention.ms=-1`, `cleanup.policy=delete` (no `compact`); `commands.bid`: `604800000` (7 d); `dlq`: `2592000000` (30 d) | La spec §4 pide log ilimitado **sin compactar** (para poder reprocesar el historial completo) |
| Auto-creación de topics | `KAFKA_AUTO_CREATE_TOPICS_ENABLE=false` | Un typo en el nombre de un topic debe fallar, no crear un topic con 1 partición |
| Persistencia | Volúmenes con nombre `bidstream_kafka`, `bidstream_pg` | `make down` conserva datos; `make reset` los borra (útil para el reproceso) |
| Credenciales | `.env.example` versionado, `.env` ignorado; usuario/clave/BD `bidstream` solo para desarrollo | Sin secretos reales en el repo |

### 2.2 Servicios

```
kafka        apache/kafka:<fijada>   puertos: ${KAFKA_PORT:-9092}:9092  healthcheck: kafka-broker-api-versions
kafka-init   mismo imagen            one-shot: crea los 3 topics
postgres     postgres:16-alpine      puerto:  ${POSTGRES_PORT:-5432}:5432  healthcheck: pg_isready
```

### 2.3 Topics

| Topic | Particiones | Config |
|---|---:|---|
| `bidstream.commands.bid` | 6 | `retention.ms=604800000`, `cleanup.policy=delete` |
| `bidstream.events.lot` | 6 | `retention.ms=-1`, `cleanup.policy=delete` |
| `bidstream.events.lot.dlq` | 1 | `retention.ms=2592000000`, `cleanup.policy=delete` |

### 2.4 Makefile

| Objetivo | Acción |
|---|---|
| `make up` | `docker compose up -d --wait` (espera healthchecks) y luego espera a `kafka-init` y muestra `make topics` |
| `make down` | `docker compose down` (conserva volúmenes) |
| `make reset` | `docker compose down -v` (borra datos) y `make up` |
| `make ps` / `make logs` | Estado / logs en seguimiento |
| `make topics` | `kafka-topics.sh --describe` de los 3 topics |
| `make psql` | Consola `psql` dentro del contenedor |

---

## 3 · Cambios por archivo/módulo

| Archivo/módulo | Cambio |
|---|---|
| `docker-compose.yml` | Nuevo: servicios de §2.2, volúmenes, red por defecto |
| `scripts/local/create-topics.sh` | Nuevo: crea los topics de §2.3 de forma idempotente; lo monta `kafka-init` |
| `Makefile` | Nuevo: objetivos de §2.4 |
| `.env.example` | Nuevo: `KAFKA_PORT`, `POSTGRES_PORT`, `POSTGRES_USER/PASSWORD/DB`, `DATABASE_URL`, `KAFKA_BROKERS` |
| `.prettierignore` | Añadir `docker-compose.yml` si Prettier lo reformatea de forma conflictiva (verificar) |
| `README.md` y `CLAUDE.md` | Añadir `make up`, puertos y qué crea |
| `docs/decisions/LOG.md` | Entrada con la versión de imagen fijada |

---

## 4 · Plan de tests

| Caso | Nivel | Cubre |
|---|---|---|
| `make reset` desde cero termina en 0 y `docker compose ps` muestra kafka y postgres *healthy* | integración (manual, script) | Arranque completo reproducible |
| `make topics` muestra los 3 topics con 6/6/1 particiones y `retention.ms` -1 / 604800000 / 2592000000 | integración | Topics y retención de la spec §4 |
| Producir y consumir un mensaje con clave en `bidstream.events.lot` desde el host (`localhost:9092`) y desde un contenedor (`kafka:19092`) | integración | Los dos listeners |
| Producir 12 mensajes con 2 claves y comprobar que cada clave cae siempre en la misma partición | integración | ADR-0001 (`lotId` → una partición) |
| `psql` conecta con `DATABASE_URL` del `.env.example` | integración | PostgreSQL accesible |
| Segundo `make up` sin cambios: sin errores, sin recrear topics | integración | Idempotencia |
| Intentar producir a un topic que no existe falla | integración | Auto-creación desactivada |

**Deliberadamente sin test automatizado:** estas comprobaciones dependen de Docker y se ejecutan a mano o en `make verify` (script `scripts/local/verify.sh` opcional). Las pruebas de integración automáticas con contenedores llegan con G1.

---

## 5 · Definition of Done

- [x] SDD en `docs/sdd/0.2/SDD.md`, Estado = Aprobado
- [x] `make up` desde cero deja Kafka y PostgreSQL *healthy* y los 3 topics creados
- [x] Particiones y retención coinciden con la spec §4 (verificado con `make topics`)
- [x] Orden por clave verificado (mismo `lotId` → misma partición)
- [x] Segundo `make up` idempotente; `make reset` limpia
- [x] Imagen de Kafka con versión fijada, sin `latest`
- [x] README/CLAUDE.md documentan comandos; `.env.example` versionado, `.env` ignorado
- [x] `npm run check` sigue en verde
- [x] Commit con conventional commits

---

## 6 · Riesgos

| Riesgo | Gravedad | Mitigación |
|---|---|---|
| Configuración de listeners de Kafka incorrecta (el error más común: el cliente del host no resuelve el broker) | Alta | Dos listeners explícitos con `ADVERTISED` distinto; caso de test desde host y desde contenedor |
| Puertos 5432/9092 ya ocupados en otra máquina | Media | Puertos configurables desde `.env` |
| `retention.ms=-1` hace crecer el disco indefinidamente | Baja | Es lo que exige el reproceso; en local, `make reset` limpia; en Azure se vigila el tamaño |
| Imagen o versión que cambie de comportamiento | Media | Versión fijada; cambiarla requiere entrada en `LOG.md` |
| El healthcheck de Kafka tarda y `make up` parece colgado | Baja | `--wait` con timeout razonable y mensaje claro |

---

## 7 · Preguntas abiertas

1. ¿Añadimos una UI de Kafka (Redpanda Console o Kafka UI) como servicio opcional por perfil de Compose? Ayuda en la demo del reproceso; no es necesario para el ticket.
2. Versión exacta de `apache/kafka`: se fija al implementar, tras comprobar que descarga y arranca; queda registrada en `LOG.md`.

---

## Changelog de implementación

- **Implementado (2026-11-12):** imagen fijada a `apache/kafka:4.3.2` (el tag 4.4.0 acababa de salir; se prefirió el parche estable anterior). Servicio `kafka-init` y Makefile según el diseño.
- Se añadió `scripts/local/verify.sh` (`make verify`) con los casos del §4 automatizados contra los contenedores: servicios sanos, topics con particiones/retención de la spec, listener del host y del contenedor, orden por clave (lotA, lotB y lotC siempre en una partición), auto-creación desactivada y `psql`. Resultado: TODO OK. Segundo `make up`: mismos `TopicId`, sin recrear.
- Corregido durante la verificación: el productor de consola devuelve código 0 aunque el envío falle; el caso "topic inexistente" comprueba `UNKNOWN_TOPIC_OR_PARTITION` y que el topic no se haya creado. `/dev/tcp` requiere `bash`, no `sh`.
- Pregunta §7 #1 (UI de Kafka): se deja para después, a petición de la propuesta aprobada.
