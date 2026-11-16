# SDD — F5 · `SECURITY.md` con el mapeo OWASP Top 10

- **Ticket:** backlog F5 (2 h, Tier 🟡). Sin id de ClickUp: la cascada de Q2/Q4/Q5 ya está cerrada.
- **Autor:** generado con Claude (Entregable 1).
- **Estado:** Implementado (2026-11-13)
- **Versión:** 0.1 · **Fecha:** 2026-11-13
- **Depende de:** F1, F2, F3, F4 y F6 — **todos implementados** (commits `786c1d3`, `aaf915e`, `52d5d86`, `5c55892`, `bddb76e`).
- **Fuentes de verdad citadas:** spec §8 (tabla OWASP); [ADR-0012](../adr/0012-firma-ed25519-de-eventos.md) (A08); [ADR-0013](../adr/0013-autenticacion-propia-y-rbac.md) (A01/A07); `docs/sdd/{F1,F2,F3,F4,F6}/SDD.md`; `docs/do-not-touch.md`.

---

## 0 · Preguntas que el ticket pidió cerrar

| # | Pregunta | Respuesta |
|---|---|---|
| 1 | ¿Dónde vive el archivo? | En la raíz, `SECURITY.md`: es la convención de GitHub y la spec dice «un archivo propio». |
| 2 | ¿Qué se hace con los controles que dependen de Azure? | Se documentan como **pendientes y bloqueados** (`Q1` → H1/H3/H4), con la mitigación actual. No se presentan como hechos. |
| 3 | ¿Cómo se evita que el documento envejezca? | Prueba de documentación (`packages/testing/src/docs/security.test.ts`): las 10 filas, los enlaces y la honestidad de los estados se comprueban en `npm run check`. |

---

## 1 · Alcance

### Entra

- `SECURITY.md` que recorre **A01–A10** con: qué se hizo, **dónde está la evidencia** (código, ADR o SDD), estado y límite conocido.
- Leyenda de estados explícita: ✅ implementado y probado · 🟡 parcial · ⛔ pendiente (con bloqueo y dueño).
- Actualización honesta del README: `SECURITY.md` sale de «lo que **no** está» y pasa a la lista de lo hecho, con enlace.
- Registro del layout en `docs/README.md` y entrada `DEC-053` en `docs/decisions/LOG.md`.
- Prueba de documentación que impide: filas faltantes, enlaces rotos, estados inventados y controles de Azure anunciados como disponibles.

### No entra

- **Implementar** TLS/Key Vault/alertas: dependen de `Q1` (H1, H3, H4 siguen bloqueados).
- Pentest externo, programa de bug bounty o política de divulgación legal más allá del canal de reporte.
- Reescribir los controles: F5 los **documenta**; un cambio de un control exige su propio ticket (y ADR si toca un subsistema protegido).
- Métricas de *consumer lag* o alertas de seguridad (H4).

### Premisas verificadas

| Premisa del ticket | Qué hay de verdad |
|---|---|
| F1, F2, F3, F4 y F6 están hechos | Sí: autenticación/RBAC, límite de pujas/cabeceras/CORS, firma Ed25519, logs con correlación y auditoría de dependencias, con pruebas en el repo. |
| `SECURITY.md` existe | No. `README.md` §«Estado y límites» lo lista como pendiente; una prueba lo exige allí. |
| «TLS en todo, secretos en Key Vault» ya está | No: TLS lo terminará el borde de Azure y Key Vault es H1. Hoy hay secretos por variables de entorno, `.env*` ignorado y claves de desarrollo fuera del repo. |
| «Alertas» ya están | No: hay logs con correlación y bitácora append-only, pero las alertas/consumer lag son H4. |
| Hay llamadas salientes con URL del usuario (A10) | No: el sistema no hace peticiones HTTP salientes; solo habla con PostgreSQL y Kafka por configuración. |

---

## 2 · Diseño técnico

**Forma del documento.** Una tabla índice al principio (A01–A10 → estado) y una sección corta por punto con cuatro campos fijos: *Qué hay*, *Evidencia*, *Estado* y *Límite*. Así el lector ve en 30 segundos qué está cubierto y el test puede verificar la estructura sin juzgar la prosa.

**Regla de evidencia.** Cada fila cita al menos un archivo del repo que existe (`apps/api/src/access-control.ts`, `packages/auth/src/password.ts`, `packages/signing/src/verifier.ts`, …) o un ADR/SDD. El test resuelve los enlaces relativos y falla si el destino no existe. Se **cita** el ADR/SDD; no se copia su contenido (se desactualizaría).

**Honestidad (lo que el test también vigila).**

| Punto | Estado real | Cómo se documenta |
|---|---|---|
| A01 control de acceso | ✅ | Denegar por defecto + roles + tenant del token + filtros por tenant en repositorios |
| A02 criptografía | 🟡 | Argon2id y Ed25519 ✅; TLS lo termina Azure y Key Vault es H1 ⛔ |
| A03 inyección | ✅ | Zod en el borde, Prisma parametrizado, SQL crudo solo con parámetros ligados, límites GraphQL |
| A04 diseño inseguro | ✅ | Límite por postor/minuto, `Idempotency-Key`, anti-sniping y cierre por el decisor |
| A05 mala configuración | ✅ | Helmet, CORS lista blanca vacía por defecto, `problem+json` sin trazas, `AUTH_MODE` forzado en producción |
| A06 componentes vulnerables | ✅ | `security.yml` (audit prod low / todo high, firmas), Dependabot, acciones por SHA, `overrides` |
| A07 autenticación | ✅ | JWT EdDSA 10 min, refresh rotatorio de un solo uso con revocación de familia, bloqueo 5/15 min |
| A08 integridad | ✅ | Firma Ed25519 de los bytes del mensaje, verificación `enforce` en producción, DLQ para venenos |
| A09 registro | 🟡 | Logs JSON con `requestId` y redacción, bitácora append-only con disparadores; alertas = H4 ⛔ |
| A10 SSRF | ✅ | Sin URLs controladas por el usuario ni cliente HTTP saliente; solo PostgreSQL/Kafka por configuración |

Los estados 🟡/⛔ van acompañados del bloqueo (`Q1`, H1, H4) y de la mitigación vigente, para que nadie lea «pendiente» como «sin protección».

**Enlaces.** `SECURITY.md` enlaza a los ADR 0012/0013 y a los SDD de F1–F4/F6; el README enlaza a `SECURITY.md`. Los enlaces son relativos a la raíz y el test los valida.

---

## 3 · Cambios por archivo/módulo

| Archivo/módulo | Cambio |
|---|---|
| `SECURITY.md` (raíz) | **Nuevo.** Alcance, canal de reporte, leyenda, tabla índice y secciones A01–A10 con evidencia/estado/límite. |
| `packages/testing/src/docs/security.test.ts` | **Nuevo.** Estructura de las 10 filas, enlaces existentes, estados válidos y honestidad de lo pendiente. |
| `packages/testing/src/docs/readme.test.ts` | `SECURITY.md` deja de ser pendiente; se exige enlace desde el README y se mantiene «Despliegue en Azure» como pendiente. |
| `README.md` | Mover `SECURITY.md` a lo hecho y enlazarlo en la línea de documentación; dejar solo Azure como pendiente. |
| `docs/README.md` | Fila `SECURITY.md` en el layout (política de seguridad y mapeo OWASP). |
| `docs/decisions/LOG.md` | `DEC-053` con el alcance, los estados 🟡/⛔ y sus bloqueos. |
| `docs/planning/2026-11-12 - Sprint-Roadmap.md` | Fila F5 en ✅ y recuento actualizado (coherencia con el resto de tickets). |
| `docs/sdd/F5/SDD.md` | Este documento; al implementar, estado y *changelog*. |

No hay cambios de código de producto, esquema ni configuración: F5 es documentación y su barrera de pruebas.

---

## 4 · Plan de tests

| Caso | Nivel | Cubre |
|---|---|---|
| Existen las 10 secciones A01–A10 y una tabla índice con los 10 estados | unit | Cobertura de la spec §8 |
| Cada sección cita al menos una evidencia existente (`.ts`, ADR o SDD) | unit | Documento anclado al repo |
| Todo enlace relativo de `SECURITY.md` apunta a un archivo existente | unit | Sin enlaces rotos |
| Los estados 🟡/⛔ nombran su bloqueo (`Q1`, H1 o H4) | unit | Honestidad |
| `SECURITY.md` no afirma TLS/Key Vault/alertas como hechos; no contiene claves privadas ni secretos | unit | Sin sobreventa ni filtración |
| README: `SECURITY.md` ya no figura como pendiente y se enlaza; Azure sigue pendiente | unit | Coherencia entre documentos |

**Lo que no se testea:** la calidad del juicio de cada control (eso lo cubren las pruebas de F1–F4/F6 y, en el futuro, un pentest) ni el contenido de OWASP, que es una fuente externa.

---

## 5 · Definition of Done

- [ ] SDD aprobado.
- [ ] `SECURITY.md` con A01–A10, evidencia enlazada y estados honestos (🟡/⛔ con bloqueo).
- [ ] README y `docs/README.md` actualizados; sin promesas de Azure.
- [ ] `security.test.ts` y `readme.test.ts` en verde.
- [ ] `npm run check` en verde (build, typecheck, lint, format y tests).
- [ ] `DEC-053` en el log y fila F5 del roadmap en ✅.
- [ ] PR fusionado.

---

## 6 · Riesgos

| Riesgo | Gravedad | Mitigación |
|---|---|---|
| El documento envejece y miente sobre lo implementado | Alta | Test que exige evidencia existente y estados con bloqueo; se actualiza con cada control |
| Confundir «pendiente en Azure» con «sin protección» | Media | Cada ⛔ lleva la mitigación actual y el dueño (H1/H4) |
| Copiar el contenido de los ADR y desincronizarse | Media | Se cita el ADR; el test solo exige el enlace |
| F5 se lee como auditoría de seguridad completa | Media | El documento declara alcance: mapeo de controles, no pentest ni certificación |

---

## 7 · Preguntas abiertas

1. **Canal de reporte:** ¿buzón de correo (`security@…`) o GitHub Security Advisories privados? Propuesta: describir ambos y dejar el correo como marcador configurable por el usuario (no inventar una dirección).
2. **Q1 sigue abierta:** TLS, Key Vault y alertas quedarán ⛔ hasta H1/H4; ¿se acepta que F5 se cierre con esos tres puntos pendientes y documentados? Propuesta: sí, es la lectura honesta de la spec.
3. **OWASP:** se usa la lista de la spec §8 (10 puntos). Si aparece una versión nueva del Top 10, se actualiza en un ticket aparte.

---

## Changelog de implementación

- `SECURITY.md` en la raíz con la tabla índice y A01–A10: qué hay, evidencia enlazada, estado y límite. TLS/Key Vault (H1/H3) y alertas (H4) se marcan 🟡/⛔ con su bloqueo, no como hechos.
- `packages/testing/src/docs/security.test.ts`: estructura, evidencia que existe, enlaces relativos, estados con bloqueo y ausencia de secretos. `readme.test.ts` deja de exigir `SECURITY.md` como pendiente.
- README (lo hecho y el enlace), `docs/README.md`, fila F5 del roadmap y `DEC-053`.
- Canal de reporte: aviso de seguridad privado de GitHub; no se inventa un buzón de correo (SDD §7.1).
