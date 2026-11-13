# SDD — I1 · README (§12) con comparación contra la versión de WebSockets

- **Ticket:** ClickUp **I1** (`868mvty22`, https://app.clickup.com/t/868mvty22).
- **Autor:** generado con Claude (Entregable 1).
- **Estado:** Borrador (2026-11-13) — pendiente de aprobación
- **Versión:** 0.1 · **Fecha:** 2026-11-13
- **Fuentes de verdad citadas:**
  1. `docs/product/bidstream_spec.md` §12 (seis puntos del README; «la sección más valiosa del repositorio» es la comparación) y §5 (el diagrama), §6 (detalles que el README debe dejar explícitos: dinero `Decimal(12,2)`, índice único parcial, límites de GraphQL)
  2. `README.md` actual (142 líneas, orientado a desarrollo: comandos, no producto)
  3. `docs/adr/README.md` y los ADR 0001–0010 (I2)
  4. La versión anterior, `~/Documentos/project-cafe/backend-c` (NestJS, WebSockets y `pg_advisory_xact_lock(hashtext(coffeeLotId))` en `bid.service.ts`; README propio)
  5. `docs/sdd/H5/SDD.md` (vídeo) y `docs/sdd/H2/SDD.md` (imágenes)

---

## 0 · Preguntas que el ticket pidió cerrar

| # | Pregunta del ticket | Respuesta |
|---|---|---|
| 1 | ¿Qué contenido, en qué orden? | Los seis puntos de §12, en ese orden, más «Estado del proyecto» con lo honesto (§2.1) |
| 2 | ¿Cómo se completa «al cerrar cada fase»? | El README declara qué está hecho y qué no; una prueba de documentación impide que afirme algo que no existe (§4) |

---

## 1 · Alcance

### Entra

- **Reescribir el `README.md`** como documento de producto (lo que lee un entrevistador) y mover el contenido de desarrollo a `docs/DESARROLLO.md` (comandos, entorno, procesos), enlazado desde el README.
- Secciones (orden de §12): 1) qué es en dos líneas y para qué producto sirve; 2) **diagrama del flujo** (Mermaid, el de §5); 3) **«Qué cambió respecto a la versión con WebSockets y bloqueos en base de datos»** con tabla, «qué ganas», «qué pierdes» y «cuándo elegirías cada una»; 4) decisiones de diseño con **enlace a cada ADR**; 5) el vídeo del reproceso (H5); 6) stack y puesta en marcha en **un solo comando**.
- Los detalles que §6 pide dejar explícitos: dinero en `Decimal(12,2)`, índice único parcial (cuando exista C3/F?, se marca como pendiente), límites de GraphQL.
- Un apartado **«Estado y límites»**: qué está hecho (núcleo de punta a punta) y qué no (puja C3, autenticación F1, Azure H1/H3), sin maquillar.
- **«Puesta en marcha en un comando»:** `make demo` (levanta Kafka y PostgreSQL, migra y deja el flujo listo).
- Pruebas de documentación (§4).

### No entra (a propósito)

- `SECURITY.md` (F5) y el despliegue en Azure (H).
- Reescribir los ADR o los SDD: el README los **enlaza**.
- Capturas/GIF de la interfaz: no hay interfaz propia.

### Premisas verificadas (heredadas de `task-brief`)

| Premisa del ticket | Qué hay de verdad |
|---|---|
| «Comparación contra `subastas-cafe-api`» | El código está en `~/Documentos/project-cafe/backend-c` (NestJS + Prisma + WebSockets); serializa con **`pg_advisory_xact_lock(hashtext(coffeeLotId))`**; su README ya declara «sin doble adjudicación» |
| «Puesta en marcha en un comando» | Hoy son varios (`make up`, `make migrate`, `npm run dev:*` ×5): **no existe un comando único**; hay que crearlo (`make demo`) |
| «Vídeo» | Es H5; el README debe enlazarlo cuando exista o marcar su ausencia sin romper |
| «Se completa al cerrar cada fase» | El README actual mezcla producto y desarrollo; la parte de producto no existe |
| Afirmaciones de rendimiento | **No hay mediciones**: la comparación se hará con propiedades demostradas por pruebas, no con cifras inventadas |

---

## 2 · Diseño técnico

### 2.1 Estructura del README

1. **Título y dos líneas** (qué es, para qué tipo de producto: subastas en vivo, mercados con cierres competitivos).
2. **Cómo funciona** (diagrama Mermaid del flujo: API → outbox → relay → Kafka → projector/notifier/auditor → PostgreSQL → GraphQL).
3. **Qué cambió respecto a la versión con WebSockets y bloqueos en BD** (tabla: orden, escalado, durabilidad, reproceso, tiempo real, simplicidad operativa, coste; + «Qué ganas», «Qué pierdes», «Cuándo elegiría cada una»).
4. **Decisiones de diseño** (tabla con una línea por ADR y el enlace).
5. **Reproceso** (vídeo de H5 y el comando).
6. **Stack y puesta en marcha** (`make demo`; requisitos Node 22 y Docker).
7. **Estado y límites** y enlaces a `docs/DESARROLLO.md`, `docs/adr/`, `docs/sdd/`, la spec.

### 2.2 La comparación (borrador de contenido)

| Aspecto | Versión anterior (WebSockets + advisory lock) | bidstream (eventos + Kafka) |
|---|---|---|
| Orden de pujas por lote | Bloqueo asesor en PostgreSQL (`pg_advisory_xact_lock`) | Partición por `lotId` ([ADR-0001](docs/adr/0001-clave-de-particion-lotid.md)) |
| Escalado | Vertical en la base: todas las pujas pasan por ella | Horizontal por particiones y consumidores |
| Durabilidad del evento | Fila de la puja | Log inmutable con retención ilimitada |
| Reproceso / corregir la proyección | No existe: hay que migrar datos | Reconstruir desde `earliest` ([ADR-0009](docs/adr/0009-el-log-es-la-fuente-de-verdad.md)) |
| Tiempo real | Gateway WebSocket con estado en cada instancia | `LISTEN/NOTIFY` + SSE ([ADR-0008](docs/adr/0008-tiempo-real-listen-notify-sse.md)) |
| Simplicidad | **Una** base y un proceso | Kafka, outbox, relay, tres consumidores |
| Consistencia | Fuerte e inmediata | Eventual (`202`, [ADR-0003](docs/adr/0003-la-puja-devuelve-202.md)) |

**Cuándo elegir cada una:** la anterior, para un volumen modesto y un equipo pequeño que valora la consistencia inmediata y la simplicidad; esta, cuando el volumen, la auditoría o la necesidad de reproceso justifican la complejidad.

### 2.3 Decisiones y por qué

| Decisión | Elección | Por qué |
|---|---|---|
| Contenido de desarrollo | Se mueve a `docs/DESARROLLO.md` | El README lo lee un entrevistador, no un colaborador |
| Honestidad | «Estado y límites» explícito | Un README que promete lo que no hay pierde toda credibilidad |
| Cifras | Ninguna sin medición | Se compara con propiedades probadas (ADR + pruebas), no con números inventados |
| Comando único | `make demo` | Cumple §12.6 |
| Verificabilidad | Pruebas de documentación | Los comandos y enlaces del README no pueden quedar rotos |

---

## 3 · Cambios por archivo/módulo

| Archivo/módulo | Cambio |
|---|---|
| `README.md` | Reescrito (§2.1) |
| `docs/DESARROLLO.md` (nuevo) | El contenido de desarrollo actual (comandos, procesos, reproceso, DLQ, GraphQL, seguridad de dependencias) |
| `Makefile` | `make demo` |
| `packages/testing/src/docs/readme.test.ts` (nuevo) | Pruebas de documentación (§4) |
| `CLAUDE.md` | Dónde está cada documento |

---

## 4 · Plan de tests

| Caso | Nivel | Cubre |
|---|---|---|
| El README tiene, en orden, las secciones de §12 | documentación | Estructura |
| Todo enlace relativo existe; todo ADR del índice está enlazado | documentación | Enlaces |
| Todo bloque con comandos `make …`/`npm run …` cita un objetivo o script que existe | documentación | Comandos vigentes |
| Cada rama de «Qué cambió…» (ganas/pierdes/cuándo) está presente | documentación | La sección clave |
| El diagrama Mermaid menciona los componentes reales (outbox, relay, projector, notifier, auditor, GraphQL) | documentación | Diagrama vigente |
| El README no afirma nada que esté marcado como pendiente (p. ej. `POST …/bids`) salvo en «Estado y límites» | documentación | Honestidad |
| `make demo` en un entorno limpio deja el flujo listo (manual y en la CI de integración si cabe) | integración/manual | Un solo comando |

**Deliberadamente sin test:** la calidad de la redacción.

---

## 5 · Definition of Done

- [ ] SDD en `docs/sdd/I1/SDD.md`, Estado = Aprobado
- [ ] README reescrito y `docs/DESARROLLO.md` con el contenido anterior
- [ ] `make demo` funciona desde cero (verificado)
- [ ] Pruebas del §4 en verde; `npm run check` en verde; PR con CI verde y fusionado

---

## 6 · Riesgos

| Riesgo | Gravedad | Mitigación |
|---|---|---|
| Caricaturizar la versión anterior | Media | Tabla con lo que **pierde** el nuevo diseño y «cuándo elegir cada una» |
| Afirmar rendimiento sin medir | Alta | Ninguna cifra sin medición; comparar propiedades |
| El vídeo (H5) no está aún | Media | Marcador explícito que la prueba acepta y que se sustituye al grabarlo |
| README desactualizado | Media | Pruebas de documentación y «Estado y límites» |

---

## 7 · Preguntas abiertas

1. **Estructura:** README de producto + `docs/DESARROLLO.md` con lo técnico (propuesta). ¿O prefieres un solo archivo largo?
2. **Comparación** con propiedades y sin cifras, citando `project-cafe/backend-c` como «versión anterior» (el repositorio `subastas-cafe-api` de la spec). ¿Mantengo ese nombre o uso el actual del repositorio?
3. **`make demo`** como comando único (Kafka + PostgreSQL + migraciones + procesos). ¿Debe arrancar también los procesos de aplicación o basta con la infraestructura y los comandos de abajo?
4. **Orden de entrega:** I1 después de H5 para enlazar el vídeo, o antes con marcador (propuesta: antes, con marcador).
5. **Idioma:** español (como el resto del repositorio). ¿Añadimos un resumen en inglés para el portafolio?
