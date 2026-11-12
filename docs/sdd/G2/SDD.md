# SDD — G2 · Prueba de reproceso: reconstruir la proyección desde el log

- **Ticket:** ClickUp **G2** (`868mvty1q`, https://app.clickup.com/t/868mvty1q).
- **Autor:** generado con Claude (Entregable 1).
- **Estado:** Aprobado (2026-11-12)
- **Versión:** 1.0 · **Fecha:** 2026-11-12
- **Fuentes de verdad citadas:**
  1. `docs/product/bidstream_spec.md` §5 ("Reproceso (lo que hay que grabar en video): borrar la proyección, reposicionar el offset del grupo `projector` a `earliest` y dejar que se reconstruya sola desde el log"), §10 (prueba de reproceso: publicar N eventos, borrar la proyección, reconstruir y verificar que el estado final es idéntico)
  2. `docs/sdd/D4/SDD.md` §2.3–2.4 (`resetProjection`, sin clave foránea entre subasta y lote, reinicio del grupo), `docs/sdd/D3/SDD.md` (idempotencia por `ProcessedEvent`)
  3. `docs/sdd/D2/SDD.md` (consumidor con commit manual, `fromBeginning`), `docs/sdd/G1/SDD.md` (utilidades de integración)
  4. `docs/sdd/A1/SDD.md` (`foldLot`, `evolveAuction` como oráculo), `docs/adr/0001-clave-de-particion-lotid.md`

---

## 0 · Preguntas que el ticket pidió cerrar

| # | Pregunta del ticket | Respuesta |
|---|---|---|
| 1 | ¿Cómo se "reposiciona el grupo a `earliest`"? | **Borrando el grupo** (`deleteGroups`) cuando está vacío: el cliente de Kafka no implementa `setOffsets` ni `resetOffsets` (§1, premisas) |
| 2 | ¿Qué significa "estado idéntico"? | Las tablas `auction`, `lot` y `bid` iguales fila a fila, e iguales al estado que reconstruye el dominio con `foldLot`/`evolveAuction` (§2.4) |

---

## 1 · Alcance

### Entra

- **Herramienta de reproceso** (`reprocessProjection` y un comando `npm run reprocess -w @bidstream/projector -- --yes`): comprueba que el `projector` está parado, vacía la proyección con `resetProjection` y reposiciona el grupo; después reconstruye y informa de cuántos eventos y cuánto tardó. Es el comando que grabará el vídeo (H5).
- En `@bidstream/kafka`: una pequeña API de administración (`describeGroup`, `deleteGroup`, `consumerLag`).
- En `@bidstream/testing`: `generateHistory({ seed, … })`, un generador **determinista** de historiales válidos (usa las reglas del dominio, no datos aleatorios sueltos).
- **Prueba de integración** del reproceso con PostgreSQL y Kafka reales, con dos consumidores en paralelo.

### No entra (a propósito)

- La grabación y edición del vídeo y el guion → H5.
- Reproceso de los demás consumidores (`notifier`, `auditor`): no mantienen una proyección que reconstruir.
- Reproceso de eventos del DLQ → D7.
- Un endpoint HTTP de reproceso: es una operación destructiva y se queda como herramienta explícita de línea de comandos (decisión de D4 §7 #4).

### Premisas verificadas (heredadas de `task-brief`)

| Premisa del ticket | Qué hay de verdad |
|---|---|
| "Reposicionar el grupo `projector` a `earliest`" | `@confluentinc/kafka-javascript` 1.11 expone `listGroups`, `describeGroups`, `deleteGroups`, `fetchOffsets` y `fetchTopicOffsets`, pero **no** `setOffsets`/`resetOffsets`. Se consigue igual: un grupo **vacío** puede borrarse con `deleteGroups`, lo que elimina sus offsets confirmados, y al volver a conectarse con `fromBeginning: true` empieza en `earliest` |
| "Dejar que se reconstruya sola" | `resetProjection` (D4) vacía `bid`, `lot`, `auction` **y** `processed_event` del `projector`; sin lo último, todos los eventos se tomarían por duplicados |
| Reconstrucción determinista | D4 quitó la clave foránea lote → subasta precisamente para que dos consumidores en paralelo no fallen si un lote se procesa antes que su subasta; esta prueba lo comprueba de verdad |
| "Publicar N eventos" | No hay generador de historiales: las pruebas de D4 usan escenarios escritos a mano de 5–10 eventos |
| Medir el avance | `fetchTopicOffsets` da el final de cada partición y `fetchOffsets` el offset confirmado del grupo: de su diferencia sale el *lag* |

---

## 2 · Diseño técnico

### 2.1 Pasos del reproceso

```
reprocessProjection({ prisma, kafka, topic, groupId = 'projector', yes })
  0. exige `yes` (operación destructiva)
  1. describeGroup(groupId): si tiene miembros activos → error «pare el projector antes» (GroupActiveError)
  2. resetProjection(prisma)                       ← una transacción: bid, lot, auction y processed_event del projector
  3. deleteGroup(groupId)                          ← borra los offsets confirmados (ignora «no existe»)
  4. devuelve { eventsInLog: Σ(high − low), … }    ← el projector, al arrancar, lee desde earliest
```

El orden importa: se vacía la base primero (atómico) y después se borra el grupo. Si el paso 3 falla, queda la proyección vacía con los offsets antiguos: el comando informa y **es idempotente**, basta repetirlo. El orden inverso dejaría la proyección llena y los offsets al principio, con `processed_event` intacto: todo se ignoraría como duplicado.

### 2.2 API de administración en `@bidstream/kafka`

```ts
createKafkaAdmin(config): Promise<KafkaAdmin>
  describeGroup(groupId): Promise<{ state: string; members: number } | null>
  deleteGroup(groupId): Promise<void>             // falla si el grupo no está vacío
  consumerLag(groupId, topic): Promise<{ total: number; partitions: { partition: number; lag: number }[] }>
  disconnect()
```

`consumerLag` es la base de las métricas de H4.

### 2.3 Generador de historiales

`generateHistory({ seed, auctions, lotsPerAuction, bidsPerLot, tenantId })` devuelve `DomainEvent[]` en orden causal, usando `decideBid`/`decideCloseLot`/`decideCloseAuction`, `evolveLot` y los `buildEvent` del dominio con reloj e ids inyectados. Un generador pseudoaleatorio con **semilla** (mulberry32) hace que `seed = 42` produzca siempre el mismo historial: pujas válidas y rechazadas, extensiones anti-sniping, lotes cerrados con ganador y desiertos, y subastas cerradas. Es el mismo generador que usará la demostración (H5).

### 2.4 Definición de «idéntico»

`snapshot()` lee `auction`, `lot` y `bid` ordenadas por `id` y las serializa. Se excluye `processed_event` (su `handled_at` es la hora real). Además se compara cada lote proyectado con `foldLot` del subconjunto de eventos de ese lote (oráculo independiente de la base de datos). Si A = B pero ambos difieren del oráculo, la prueba falla.

### 2.5 Decisiones y por qué

| Decisión | Elección | Por qué |
|---|---|---|
| Reposicionar | `deleteGroups` sobre un grupo vacío | Es lo que ofrece el cliente; el efecto es el que pide la spec (leer desde `earliest`) |
| Herramienta | CLI dentro de `apps/projector` | Comparte configuración y composición con el proceso; `--yes` evita lanzarla por error |
| Concurrencia de la prueba | **Dos** consumidores del mismo grupo reconstruyen a la vez | Reparten las 6 particiones y reproducen el caso que la clave foránea habría roto |
| Datos | ~150 eventos (4 subastas × 3 lotes × ~10 pujas) con semilla fija | Suficientes para cubrir todas las ramas y las 6 particiones; segundos de ejecución |
| Detección de «ya alcanzó» | `consumerLag` = 0 **y** número de resultados del consumidor = eventos en el log | Con el lag solo, un consumidor aún procesando podría parecer terminado |
| Ubicación de las pruebas | `apps/projector/src/reprocess.int.test.ts` | La herramienta vive ahí |

---

## 3 · Cambios por archivo/módulo

| Archivo/módulo | Cambio |
|---|---|
| `packages/kafka/src/admin.ts` | `createKafkaAdmin` con `describeGroup`, `deleteGroup`, `consumerLag` |
| `packages/kafka/src/index.ts` | Reexporta la administración |
| `packages/testing/src/history.ts` | `generateHistory` con PRNG de semilla |
| `packages/testing/src/index.ts` | Reexporta el generador |
| `apps/projector/src/reprocess.ts` | `reprocessProjection`, `GroupActiveError` |
| `apps/projector/src/reprocess-cli.ts` | Comando: argumentos, confirmación `--yes`, reconstrucción en proceso y resumen |
| `apps/projector/package.json` | Script `reprocess` |
| `apps/projector/src/reprocess.int.test.ts` | Pruebas de §4 |
| `README.md`, `CLAUDE.md` | Cómo reprocesar |

---

## 4 · Plan de tests

| Caso | Nivel | Cubre |
|---|---|---|
| `generateHistory` es determinista (misma semilla → mismos eventos), válido contra `parseEvent`, y cubre pujas rechazadas, extensiones, lotes con ganador y desiertos | unit | Generador |
| Cada lote del historial generado, plegado con `foldLot`, cumple las reglas (sin doble adjudicación, precio solo crece) | unit | Generador válido |
| `describeGroup` distingue un grupo con miembros de uno vacío; `deleteGroup` falla con un grupo activo y funciona con uno vacío | integración | Administración |
| `consumerLag` es el total antes de consumir y 0 después | integración | Lag |
| **Reproceso completo:** publicar ~150 eventos en 6 particiones, proyectar con dos consumidores, `snapshot` A igual al oráculo (`foldLot`) | integración | Línea base |
| Parar, `reprocessProjection`: proyección y `processed_event` del `projector` vacíos; lag = total de eventos | integración | Reinicio |
| Reconstruir con dos consumidores en paralelo: `snapshot` B **igual** a A, DLQ vacío | integración | **Estado idéntico** |
| Repetir con **un** consumidor: `snapshot` C igual a A | integración | Independencia de la concurrencia |
| `reprocessProjection` mientras el `projector` está activo → `GroupActiveError` y **no** borra nada | integración | Seguridad |
| `reprocessProjection` sin `yes` lanza y no hace nada | integración | Confirmación |
| Los registros de `processed_event` de otros consumidores (`notifier`) sobreviven | integración | Aislamiento |
| Ejecutarlo dos veces seguidas es inofensivo | integración | Idempotencia |

**Deliberadamente sin test:** el vídeo; rendimiento con millones de eventos; el CLI como proceso (su lógica es `reprocessProjection`, probada).

---

## 5 · Definition of Done

- [ ] SDD en `docs/sdd/G2/SDD.md`, Estado = Aprobado
- [ ] `npm run reprocess -w @bidstream/projector -- --yes` reconstruye la proyección y la deja idéntica
- [ ] La prueba demuestra estado idéntico con concurrencia distinta y contra el oráculo del dominio
- [ ] El generador de historiales es determinista y reutilizable por H5
- [ ] Tests del §4 en verde; `npm run check` y `npm run test:integration` en verde
- [ ] PR con CI verde y fusionado

---

## 6 · Riesgos

| Riesgo | Gravedad | Mitigación |
|---|---|---|
| `deleteGroups` no está soportado igual por Azure Event Hubs | Media | Verificar en H1; si no, `resetProjection` + un grupo nuevo (`projector-v2`) con `fromBeginning` es equivalente |
| Ejecutar el reproceso por error en un entorno real | Alta | Exige `--yes`, comprueba que el grupo está vacío, no es una ruta HTTP; en Azure se protege además con permisos de la base de datos |
| La prueba es lenta o inestable por la sincronización de consumidores | Media | Espera por condición (`waitFor` con lag y resultados), no por tiempo; tiempos máximos generosos |
| Una reconstrucción larga deja la lectura obsoleta durante el proceso | Media | Esperado: mientras reconstruye, GraphQL devuelve estado parcial; se documenta en el README |
| El generador crea historiales que el dominio no aceptaría | Media | Se construye con las propias funciones del dominio y se valida con `parseEvent` y `foldLot` |

---

## 7 · Preguntas abiertas

1. **Reposicionar con `deleteGroups`** (propuesta) porque el cliente no implementa `setOffsets`. ¿De acuerdo? Alternativa: cambiar de librería (p. ej. `@platformatic/kafka`), lo que no compensa solo por esto.
2. **El comando vive en `apps/projector`** con `--yes` (propuesta). ¿O prefieres un `apps/tools` aparte para operaciones administrativas (reproceso, DLQ)?
3. **Tamaño de la prueba:** ~150 eventos, dos consumidores en paralelo. ¿Quieres además una variante de mayor volumen (p. ej. 5 000 eventos) marcada como lenta y fuera de la CI normal?
4. **El generador de historiales** vive en `@bidstream/testing` y servirá a H5 (demostración). ¿De acuerdo?
