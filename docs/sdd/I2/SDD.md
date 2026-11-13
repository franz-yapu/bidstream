# SDD — I2 · ADRs de las decisiones de diseño

- **Ticket:** ClickUp **I2** (`868mvty26`, https://app.clickup.com/t/868mvty26).
- **Autor:** generado con Claude (Entregable 1).
- **Estado:** Borrador
- **Versión:** 1.0 · **Fecha:** 2026-11-13
- **Fuentes de verdad citadas:**
  1. `docs/product/bidstream_spec.md` §10 ("ADRs numerados para cada decisión: clave de partición, outbox, 202 en la puja, GraphQL solo para lecturas"), §12 punto 4 ("las decisiones de diseño que vale la pena mirar, con el enlace a cada ADR"), §5, §7
  2. `docs/adr/0000-template.md` y `docs/adr/0001-clave-de-particion-lotid.md` (estilo ya fijado)
  3. `docs/sdd/*/SDD.md` y `docs/decisions/LOG.md` (DEC-001…DEC-036): material de donde sale cada decisión
  4. `docs/do-not-touch.md` (los subsistemas protegidos remiten a su ADR)

---

## 0 · Preguntas que el ticket pidió cerrar

| # | Pregunta del ticket | Respuesta |
|---|---|---|
| 1 | ¿Qué ADRs se escriben? | Los 3 que pide el ticket más **6 de decisiones ya implementadas** que el README tiene que enlazar (§2.1) |

---

## 1 · Alcance

### Entra

- Los **3 ADRs del ticket**: outbox (escritura dual), `202 Accepted` en la puja, GraphQL solo para lecturas.
- **6 ADRs de decisiones reales** tomadas durante la implementación, con las alternativas que se descartaron y la evidencia (pruebas) que las respalda.
- `docs/adr/README.md`: índice con estado y enlaces.
- Actualizar la plantilla `0000-template.md` con las secciones «Alternativas» y «Verificación».
- Enlazar los ADRs desde `docs/do-not-touch.md` y entre sí.
- **Pruebas de documentación** que impiden que se rompa la numeración, las secciones o los enlaces.

### No entra (a propósito)

- El README principal (§12) → I1; aquí solo se deja listo el índice que I1 enlazará.
- ADRs de decisiones aún no tomadas (Q2, Q4, Q5, Q3, Q1): se escribirán cuando se decidan.
- Reescribir los SDD: los ADRs **citan** los SDD (la copia se desactualiza, el original no).

### Premisas verificadas (heredadas de `task-brief`)

| Premisa del ticket | Qué hay de verdad |
|---|---|
| "ADRs: outbox, 202 en la puja, GraphQL solo lecturas" | Solo existe el ADR-0001. Outbox y GraphQL de lectura **están implementados** y probados; el `202 Accepted` en la puja **no está implementado todavía** (C3 sigue bloqueado por Q2): es una decisión de la spec que el ADR formaliza |
| La spec pide ADRs «para cada decisión» | Durante la implementación se tomaron decisiones de peso que hoy solo están en SDD y en el log y que un lector del repositorio querría encontrar como ADR (sin clave foránea entre agregados, un solo relay activo, idempotencia y DLQ, reproceso, `LISTEN/NOTIFY`, tenant provisional) |
| Calidad de los ADRs | ADR-0001 fija el estilo: contexto, decisión, alternativas en tabla y consecuencias con lo que se gana y lo que se pierde |
| Enlaces | `docs/do-not-touch.md` ya remite al ADR-0001; los demás subsistemas protegidos no remiten a ninguno |

---

## 2 · Diseño técnico

### 2.1 Los ADRs

| N.º | Título | Origen | Estado |
|---|---|---|---|
| 0001 | Clave de partición `lotId` | Spec §4 | Aceptada (existe) |
| **0002** | Patrón outbox: nunca escritura dual | Spec §5; B2, D1 | Aceptada |
| **0003** | La puja devuelve `202 Accepted`, no `201` | Spec §7; C3 (pendiente) | Aceptada (la implementación llega con C3) |
| **0004** | GraphQL solo para lecturas, REST para comandos | Spec §7; E1–E3 | Aceptada |
| 0005 | Proyección sin clave foránea entre agregados de particiones distintas | D4 §2.4 | Aceptada |
| 0006 | Un único relay activo con bloqueo asesor | D1 §2.2 | Aceptada |
| 0007 | Consumidores idempotentes: registro en la misma transacción, reintentos y DLQ | D3 | Aceptada |
| 0008 | Tiempo real con `LISTEN/NOTIFY` y SSE | D5, E3 | Aceptada |
| 0009 | El log es la fuente de verdad: reproceso desde `earliest` | Spec §5; G2 | Aceptada |
| 0010 | Tenant provisional por cabecera, prohibido en producción | C2, E1 | Aceptada (provisional hasta F1) |

Los tres primeros son los del ticket; del 0005 al 0010 son las decisiones reales que el README (I1 §4) debe enlazar.

### 2.2 Contenido de cada ADR (resumen)

| ADR | Decisión | Alternativas descartadas | Se gana / se pierde | Evidencia |
|---|---|---|---|---|
| 0002 | La API escribe el evento en la tabla `outbox_message` **en la misma transacción** que la validación; un relay lo publica después | Escribir en la base y publicar en Kafka como dos pasos; transacciones distribuidas (2PC); *change data capture* | + no se pierden ni inventan eventos; − latencia extra y un componente más (relay), entrega al menos una vez | B2 (atomicidad: rollback sin outbox), D1 (orden, fallo parcial), D3 (idempotencia) |
| 0003 | `POST …/bids` responde 202: el comando se **acepta**, el resultado llega por evento | 201 con el resultado síncrono; esperar el evento antes de responder | + coherente con un sistema asíncrono; − el cliente debe esperar el resultado (suscripción o consulta); **pendiente de implementar** | SDD C3 (cuando se escriba) |
| 0004 | Comandos por REST, lecturas por GraphQL; GraphQL sin mutaciones | GraphQL para todo; REST para todo; CQRS dentro de un mismo servidor | + escalado separado y lecturas flexibles sobre la proyección; − dos APIs y dos esquemas de errores | E1 (solo lecturas), E2 (límites) |
| 0005 | Sin FK `lot → auction`; la integridad la valida C2 al aceptar el comando | Mantener la FK y reintentar; un único topic con una sola clave | + reproceso determinista; − la base no impide lotes huérfanos | D4 (reproceso con dos consumidores idéntico) |
| 0006 | Un relay activo (bloqueo asesor de sesión) y otro en espera | Varios relays con `SKIP LOCKED`; particionar las filas por clave | + orden por lote garantizado; − un solo publicador a la vez | D1 (liderazgo, orden) |
| 0007 | `ProcessedEvent(eventId, consumer)` en la misma transacción que el handler; 4 intentos; DLQ | Idempotencia en memoria; exactly-once de Kafka; sin DLQ | + un evento se aplica una vez aunque se entregue dos; − una fila por evento y consumidor; un evento en DLQ no detiene al resto | D3 (11 pruebas), D7 |
| 0008 | El `notifier` hace `pg_notify` dentro de la transacción; cada réplica GraphQL escucha; SSE | Un grupo de Kafka por réplica; Redis; WebSockets | + sin infraestructura nueva ni límite de grupos; − entrega best-effort | D5, E3 (flujo completo) |
| 0009 | El log es la fuente de verdad; reposicionar borrando el grupo vacío y reconstruir | Instantáneas de la proyección; reparar a mano | + reconstrucción determinista demostrada; − la lectura es parcial mientras reconstruye | G2 (estado idéntico con 1 y 2 consumidores) |
| 0010 | `X-Tenant-Id` solo fuera de producción; en producción la API no arranca | Cabecera aceptada siempre; tenant fijo | + el modo inseguro no puede llegar a producción; − no se puede desplegar hasta F1 | C2, E1 (configuración) |

### 2.3 Formato (la plantilla actualizada)

Cada ADR: **Estado**, **Fecha**, **Contexto**, **Decisión**, **Alternativas descartadas** (tabla con el porqué), **Consecuencias** (se gana / se pierde / obliga a), **Verificación** (pruebas y SDD que la respaldan, con rutas) y, si aplica, **Reemplaza a / Reemplazada por**. La fecha de los ADRs de decisiones de la spec es la de su formalización (2026-11-13), indicando que la decisión viene de la spec.

### 2.4 Decisiones y por qué

| Decisión | Elección | Por qué |
|---|---|---|
| Más de 3 ADRs | 9 nuevos | Los 6 extra no son relleno: son las decisiones que un entrevistador preguntaría y que hoy están dispersas en SDD |
| ADR de una decisión no implementada (0003) | Se escribe con estado Aceptada y una nota explícita | La decisión es de la spec y condiciona a C3; ocultarlo sería peor |
| Citar los SDD, no copiarlos | Cada ADR enlaza al SDD y a las pruebas | La copia se desactualiza; el original no |
| La «Verificación» con rutas de pruebas | Obligatoria | Un ADR sin evidencia es una opinión |
| Estados | `Propuesta`, `Aceptada`, `Reemplazada por NNNN` | Los de la plantilla |
| Índice | `docs/adr/README.md` con tabla | Lo enlazará el README (I1) |

---

## 3 · Cambios por archivo/módulo

| Archivo/módulo | Cambio |
|---|---|
| `docs/adr/0002-…md` a `0010-…md` | Los 9 ADRs de §2.1 |
| `docs/adr/README.md` | Índice: número, título, estado, fecha y origen |
| `docs/adr/0000-template.md` | Añadir «Alternativas descartadas» y «Verificación» |
| `docs/do-not-touch.md` | Cada subsistema protegido remite a su ADR (outbox → 0002, log → 0009, contrato de eventos → 0001/0007…) |
| `packages/testing/src/docs/adr.test.ts` | Pruebas de documentación (§4) |
| `README.md`, `CLAUDE.md` | Cómo escribir un ADR (una línea) |
| `docs/product/bidstream_spec.md` | Sin cambio |

---

## 4 · Plan de tests

Pruebas sobre los archivos de `docs/adr/` (no necesitan infraestructura).

| Caso | Nivel | Cubre |
|---|---|---|
| La numeración es contigua desde 0001 y cada archivo se llama `NNNN-slug.md` | unit (documentación) | Orden |
| Cada ADR tiene las secciones obligatorias (Estado, Fecha, Contexto, Decisión, Alternativas, Consecuencias, Verificación) | unit | Estructura |
| El estado es uno de `Propuesta`, `Aceptada` o `Reemplazada por NNNN` (y la referencia existe) | unit | Estado válido |
| La fecha tiene formato ISO | unit | Fecha |
| Todos los enlaces relativos de los ADRs apuntan a archivos que existen | unit | Enlaces |
| Las rutas citadas en «Verificación» (pruebas, SDD) existen en el repositorio | unit | Evidencia real |
| El índice `docs/adr/README.md` lista todos los ADRs, sin sobrantes | unit | Índice |
| `docs/do-not-touch.md` remite a un ADR que existe en cada subsistema protegido | unit | Enlaces de protección |
| Los ADR de decisiones citan al menos un SDD | unit | Trazabilidad |

**Deliberadamente sin test:** que el razonamiento sea correcto (lo revisa quien lee).

---

## 5 · Definition of Done

- [ ] SDD en `docs/sdd/I2/SDD.md`, Estado = Aprobado
- [ ] ADRs 0002–0010 escritos con alternativas y verificación, y el índice
- [ ] `do-not-touch.md` enlaza a cada ADR correspondiente
- [ ] Pruebas de documentación en verde
- [ ] Tests del §4 en verde; `npm run check` en verde
- [ ] PR con CI verde y fusionado

---

## 6 · Riesgos

| Riesgo | Gravedad | Mitigación |
|---|---|---|
| Un ADR afirma algo que el código ya no hace | Media | «Verificación» con rutas comprobadas por test; los cambios exigen un ADR que reemplace |
| ADR-0003 describe un comportamiento que aún no existe | Media | Nota explícita y se revisará al implementar C3 (puede cambiar si Q2 cambia la arquitectura) |
| Demasiados ADRs diluyen los importantes | Baja | Índice ordenado y los tres de la spec primero |
| Pruebas de documentación frágiles | Baja | Solo comprueban estructura, enlaces y rutas, no el texto |

---

## 7 · Preguntas abiertas

1. **Alcance:** los 3 ADRs del ticket **más 6 de decisiones ya implementadas** (propuesta). El ticket estimaba 3 h; con 9 serán más (≈ 5–6 h). ¿De acuerdo?
2. **ADR-0003 (`202`)** sin implementación todavía, con estado Aceptada y nota. ¿O prefieres esperar a C3 y dejarlo `Propuesta`?
3. **El ADR del tenant provisional** (0010): ¿lo mantenemos como decisión formal o basta con `LOG.md`? Propuesta: ADR, porque condiciona el despliegue en Azure.
4. **Pruebas de documentación** sobre la estructura y los enlaces de los ADRs (propuesta).
