# SDD — G1 · Utilidades de pruebas de integración y job de CI

- **Ticket:** ClickUp **G1** (`868mvty1g`, https://app.clickup.com/t/868mvty1g).
- **Autor:** generado con Claude (Entregable 1).
- **Estado:** Aprobado (2026-11-12)
- **Versión:** 1.0 · **Fecha:** 2026-11-12
- **Fuentes de verdad citadas:**
  1. `docs/product/bidstream_spec.md` §10 (pruebas de integración contra PostgreSQL y Kafka reales, no mocks; CI con pruebas)
  2. `docs/sdd/B1/SDD.md` §4 y `docs/sdd/D2/SDD.md` §4 (pruebas de integración existentes), `docs/sdd/0.2/SDD.md` (`make up`)
  3. `docs/sdd/0.3/SDD.md` (CI base; `check` es el check requerido)
  4. `vitest.integration.config.ts`, `packages/db/src/db.int.test.ts`, `packages/kafka/src/kafka.int.test.ts`

---

## 0 · Preguntas que el ticket pidió cerrar

| # | Pregunta del ticket | Respuesta |
|---|---|---|
| 1 | ¿testcontainers o contra `make up`? | **Contra `make up`**, con una base de datos y topics desechables por prueba (§2.1) |

---

## 1 · Alcance

### Entra

- Paquete interno `packages/testing` (`@bidstream/testing`, privado) con utilidades de integración: base de datos desechable con migraciones aplicadas, topics desechables, espera por condición y recogida de mensajes de Kafka.
- Refactorizar `db.int.test.ts` y `kafka.int.test.ts` para usar esas utilidades (sin perder casos).
- Un test de ejemplo que cruce **outbox → Kafka → consumidor** con las utilidades (sin relay: el relay es D1).
- **Job `integration` en la CI**: levanta el entorno con `make up`, ejecuta `npm run test:integration` y lo apaga.

### No entra (a propósito)

- El relay de outbox y los consumidores reales (D1, D3, D4…); aquí solo los ayudantes que usarán sus pruebas.
- Pruebas de rendimiento o carga.
- Hacer `integration` un check obligatorio de `main` (decisión de §7 #2).
- Pruebas end-to-end por HTTP (llegan con C2/C3).

### Premisas verificadas (heredadas de `task-brief`)

| Premisa del ticket | Qué hay de verdad |
|---|---|
| "Utilidades de prueba de integración… arranque de PostgreSQL con migraciones, Kafka con los topics" | Ya hay dos suites (`db.int.test.ts` 257 líneas, `kafka.int.test.ts` 133) con **código duplicado**: creación de base de datos desechable, `migrate deploy`, creación y borrado de topics, `collect` de mensajes |
| "Job de CI aparte" | La CI solo tiene el job `check` (sin servicios); `test:integration` nunca corre en GitHub |
| Entorno | `make up` funciona en cualquier máquina con Docker; los *runners* `ubuntu-latest` traen Docker y Compose |
| Alternativa testcontainers | Añadiría una dependencia, necesita el socket de Docker y arrancaría un contenedor por suite (más lento); el repositorio ya exige `make up` para desarrollar |

---

## 2 · Diseño técnico

### 2.1 Decisiones y por qué

| Decisión | Elección | Por qué |
|---|---|---|
| Infraestructura | El `make up` existente | Misma pila que en desarrollo: lo que pasa en CI es lo que ve cualquier colaborador; cero dependencias nuevas |
| Aislamiento | Una base de datos nueva (`bidstream_test_<uuid>`) por suite y topics con sufijo aleatorio por prueba; se borran al terminar | Las pruebas no se pisan ni dejan datos; el log `bidstream.events.lot` de retención ilimitada nunca se ensucia |
| Ubicación | `packages/testing`, no exportado desde ningún paquete de producción | Código de prueba separado; una regla de ESLint impide importarlo desde archivos que no sean `*.test.ts` |
| Ejecución | Suites en serie (`fileParallelism: false`, ya configurado) | Comparten un solo Kafka/Postgres; evita competir por recursos |
| CI | Job `integration` paralelo al `check`, con `make up` + `--wait`, volcado de logs si falla | No alarga el job rápido y no cambia el check requerido |
| Salida de fallos | En fallo, `docker compose logs` como paso `if: failure()` | Diagnosticar sin reproducir |

### 2.2 API de `@bidstream/testing`

```ts
createTestDatabase(): Promise<{ url: string; prisma: PrismaClient; pool: pg.Pool; drop(): Promise<void> }>
createTestTopic(opts?: { partitions?: number }): Promise<{ name: string; drop(): Promise<void> }>
testKafkaConfig(): KafkaConfig                       // KAFKA_BROKERS o localhost:9092
waitFor(condition: () => boolean | Promise<boolean>, opts?: { timeoutMs?: number; intervalMs?: number }): Promise<void>
collectMessages(opts: { topic: string; groupId?: string; count: number; timeoutMs?: number }): Promise<IncomingMessage[]>
```

`createTestDatabase` crea la base, aplica `prisma migrate deploy` y devuelve cliente Prisma y *pool* `pg`. Las variables `DATABASE_URL` y `KAFKA_BROKERS` del entorno tienen prioridad sobre los valores locales por defecto.

### 2.3 Job de CI

```yaml
  integration:
    runs-on: ubuntu-latest
    timeout-minutes: 15
    steps:
      - checkout, setup-node (.nvmrc, cache npm) por SHA, igual que `check`
      - run: npm ci
      - run: make up
      - run: npm run build
      - run: npm run test:integration
      - if: failure()  run: docker compose logs --no-color
      - if: always()   run: make down
```

---

## 3 · Cambios por archivo/módulo

| Archivo/módulo | Cambio |
|---|---|
| `packages/testing/**` | Nuevo `@bidstream/testing`: `database.ts`, `kafka.ts`, `wait.ts`, `index.ts`, tsconfig, pruebas propias |
| `packages/db/src/db.int.test.ts` | Usa `createTestDatabase`; se elimina el código duplicado |
| `packages/kafka/src/kafka.int.test.ts` | Usa `createTestTopic` y `collectMessages` |
| `packages/testing/src/outbox-to-kafka.int.test.ts` | Test de ejemplo: fila de outbox → publicación → consumo |
| `.github/workflows/ci.yml` | Job `integration` según §2.3 (acciones por SHA, permisos mínimos) |
| `eslint.config.js` | `@bidstream/testing` solo importable desde `**/*.test.ts` |
| `tsconfig.json` (raíz) | Referencia al nuevo paquete |
| `README.md`, `CLAUDE.md` | Cómo correr las pruebas de integración y qué hace la CI |

---

## 4 · Plan de tests

| Caso | Nivel | Cubre |
|---|---|---|
| `createTestDatabase` deja las cinco tablas migradas y `drop()` elimina la base | integración | Utilidad de base de datos |
| Dos llamadas simultáneas obtienen bases distintas | integración | Aislamiento |
| `createTestTopic` crea un topic con las particiones pedidas y `drop()` lo borra | integración | Utilidad de Kafka |
| `collectMessages` devuelve exactamente `count` mensajes y falla con un error claro al agotar el tiempo | integración | Recogida de mensajes |
| `waitFor` resuelve cuando la condición se cumple y falla con timeout | unit | Espera |
| Ejemplo: insertar `OutboxMessage` con un evento válido, publicarlo y recibirlo con la misma clave y cabeceras | integración | Cruce outbox → Kafka |
| Las suites existentes (12 de base de datos, 4 de Kafka) siguen pasando tras el refactor | integración | Sin regresiones |
| El job `integration` pasa en GitHub (PR real) y falla si se rompe una prueba (rama descartable) | CI | Pipeline |
| Importar `@bidstream/testing` desde un archivo que no es de prueba falla en ESLint | lint | Aislamiento del código de prueba |

**Deliberadamente sin test:** el comportamiento de Docker Compose en los *runners*; se valida con la ejecución real del job.

---

## 5 · Definition of Done

- [ ] SDD en `docs/sdd/G1/SDD.md`, Estado = Aprobado
- [ ] `@bidstream/testing` con las cuatro utilidades y sus pruebas
- [ ] Suites existentes refactorizadas, sin casos perdidos (16 siguen en verde)
- [ ] Job `integration` en verde en un PR real y en rojo con un fallo deliberado
- [ ] Documentación de cómo correr las pruebas en local y en CI
- [ ] `npm run check` en verde
- [ ] PR con CI verde y fusionado

---

## 6 · Riesgos

| Riesgo | Gravedad | Mitigación |
|---|---|---|
| Pruebas lentas o inestables en CI (arranque de Kafka, 30–60 s) | Media | `--wait` con healthchecks, tiempos de espera generosos, `waitFor` en lugar de `sleep` |
| El job de integración se vuelve obligatorio y bloquea el trabajo por una caída intermitente | Media | No se exige al principio (§7 #2); se exige tras varias ejecuciones estables |
| Bases de datos y topics huérfanos si una prueba muere | Baja | Nombres con prefijo `bidstream_test_`/`bidstream.test.`; `make reset` los limpia en local; los *runners* son efímeros |
| Que una utilidad de prueba se cuele en código de producción | Media | Regla de ESLint de §2.1 |

---

## 7 · Preguntas abiertas

1. ¿`make up` (propuesta) o testcontainers? Con `make up` quien clone el repositorio ya tiene el entorno; testcontainers haría las pruebas autocontenidas pero con una dependencia más y más tiempo por suite.
2. ¿El job `integration` debe ser check requerido de `main`? Propuesta: no al principio; sí cuando lleve una semana estable.
3. ¿Subimos también `docker compose logs` como artefacto del job al fallar, o solo al log? Propuesta: solo al log.
