# SDD — F3 · Firma de eventos y verificación en el consumidor

- **Ticket:** ClickUp **F3** (`868mw2q37`, https://app.clickup.com/t/868mw2q37).
- **Autor:** generado con Claude (Entregable 1).
- **Estado:** Implementado (2026-11-13)
- **Versión:** 0.1 · **Fecha:** 2026-11-13
- **Decisión que lo desbloquea:** **Q5** = Ed25519 asimétrica (respuesta del usuario, 2026-11-13).
- **Fuentes de verdad citadas:** spec §8 (A08: «firma de los eventos y verificación en el consumidor»); `packages/consumer/src/processor.ts` (ya existe el gancho `verify(message, event)` que envía a DLQ como `poison`); `apps/relay/src/relay.ts` (`toRequest`); `packages/consumer/src/dlq-admin.ts` (republica el original intacto)

---

## 0 · Preguntas que el ticket pidió cerrar

| # | Pregunta | Respuesta |
|---|---|---|
| 1 | ¿Algoritmo y gestión de clave? | Ed25519; clave privada solo en el relay, públicas en cada consumidor; identificadas por `kid` para rotar |

---

## 1 · Alcance

### Entra

- Paquete `@bidstream/signing`: `signMessage(value, key)`, `verifyMessage(value, signature, keys)` con `node:crypto` (sin dependencias), `loadSigningKey(env)`, `loadVerificationKeys(env)`, generación de pares (`npm run keys:generate`).
- **Firma**: el relay firma los **bytes exactos del valor** publicado (UTF-8) y añade las cabeceras `x-signature` (base64url) y `x-key-id`.
- **Verificación**: `verify` del procesador (D3) para los cuatro consumidores y para el decisor (comandos). Firma ausente, inválida o `kid` desconocido → `poison` al DLQ, sin reintentos.
- **Configuración**: `EVENT_SIGNING_PRIVATE_KEY` + `EVENT_SIGNING_KEY_ID` (relay); `EVENT_VERIFICATION_KEYS` = JSON `{kid: clave pública}` (consumidores); `EVENT_SIGNATURE_MODE=enforce|off` (por defecto `enforce` en producción, `off` fuera, para no romper el desarrollo).
- **Eventos antiguos sin firma**: `EVENT_SIGNING_REQUIRED_FROM` (instante ISO); lo anterior se acepta sin firma, para que el reproceso desde `earliest` (ADR-0009) no rechace el historial previo.
- D7: el reproceso del DLQ conserva las cabeceras de firma (`x-signature`, `x-key-id`).
- ADR nuevo (firma de eventos) y política de rotación documentada.

### No entra

- Cifrado de los mensajes; mTLS entre servicios.
- Custodia en Azure Key Vault (H1): aquí se lee de variables de entorno.

### Premisas verificadas

| Premisa | Qué hay de verdad |
|---|---|
| Hay gancho de verificación | Sí (`ProcessorDeps.verify`), hoy sin uso |
| La firma debe cubrir el valor exacto | Sí: el relay publica `JSON.stringify(row.payload)`; el mismo texto se firma y se verifica sin recanonicalizar |
| El reproceso del DLQ republica el original | Sí, intacto; faltaría copiar las cabeceras |
| Historial sin firma en el log | Sí, todo el actual: de ahí `REQUIRED_FROM` |

---

## 2 · Diseño técnico

| Decisión | Elección | Por qué |
|---|---|---|
| Qué se firma | Bytes del valor del mensaje | Evita ambigüedades de serialización |
| Algoritmo | Ed25519 (`crypto.sign(null, …)`) | Q5; rápido, claves pequeñas, sin parámetros |
| Dónde viaja | Cabeceras Kafka | No altera el contrato del evento (`version`) |
| Verificación fallida | `poison` (DLQ, sin reintentos) | Reintentar no la arregla; D7 no la republica |
| Rotación | Varias públicas por `kid`; el relay firma con la nueva | Sin ventana de corte |
| Compromiso de la privada | Retirar el `kid` de `EVENT_VERIFICATION_KEYS` | Los eventos firmados con esa clave dejan de aceptarse (se documenta el coste de reproceso) |

---

## 3 · Cambios por archivo/módulo

| Archivo/módulo | Cambio |
|---|---|
| `packages/signing` (nuevo) | Firma, verificación, carga de claves, tests |
| `apps/relay` | Firma y cabeceras |
| `packages/consumer` | `verifyWithKeys(...)` conectado a `createEventConsumer`; `dlq-admin` conserva cabeceras |
| `apps/{projector,auditor,notifier,decider}` | Pasan las claves públicas |
| `.env.example`, compose | Variables (claves de **desarrollo** generadas por `make demo`, nunca versionadas) |
| `docs/adr/0012-…`, `SECURITY` (F5) | Firma de eventos |

---

## 4 · Plan de tests

| Caso | Nivel | Cubre |
|---|---|---|
| Firma y verificación: válida, valor alterado un byte, firma alterada, `kid` desconocido, firma ausente | unit | Núcleo |
| Una firma Ed25519 de otra clave no verifica | unit | Aislamiento |
| El relay publica `x-signature` y `x-key-id` y verifican | integración | Firma |
| Un mensaje manipulado en el topic llega al DLQ como `poison` y **no** se aplica | integración | A08 |
| Un consumidor **no puede** firmar (solo tiene la pública) | unit | Asimetría |
| Rotación: eventos con dos `kid` se aceptan; con `kid` retirado, no | integración | Rotación |
| Historial sin firma anterior a `REQUIRED_FROM` se acepta; posterior sin firma, no | integración | Reproceso |
| Reproceso G2 completo con eventos mixtos firmados/sin firmar | integración | ADR-0009 |
| D7 conserva la firma al republicar | integración | Cabeceras |
| La clave privada nunca aparece en logs ni en el DLQ | integración | Secretos |

---

## 5 · Definition of Done

- [ ] SDD Aprobado; implementación; tests; `npm run check` e `integration` en verde; PR fusionado

## 6 · Riesgos

| Riesgo | Gravedad | Mitigación |
|---|---|---|
| Historial anterior rechazado | Alta | `EVENT_SIGNING_REQUIRED_FROM` y prueba de reproceso mixto |
| Clave privada en el entorno | Media | Solo el relay la tiene; Key Vault en H1; nunca en imágenes ni logs |
| Un cambio de serialización invalida firmas | Media | Se firma el texto publicado, no el objeto |

## 7 · Preguntas abiertas

1. **Modo por defecto:** `enforce` en producción y `off` fuera (propuesta). ¿O `enforce` también en desarrollo?
2. **Corte del historial** con `EVENT_SIGNING_REQUIRED_FROM` (propuesta). ¿Bien?
3. **Claves de desarrollo** generadas automáticamente por `make demo` (no versionadas). ¿Bien?

---

## Changelog de implementación

- `@bidstream/signing`: `signMessage`/`verifySignature` (Ed25519, base64url), `createMessageVerifier` (modos `enforce`/`off`, corte del historial, rotación por `kid`), `loadSigningKey`, `loadVerificationConfig`, `verifierFromEnv`; 19 pruebas unitarias (manipulación de un byte, otra clave, asimetría, rotación, corte, PEM o base64, la clave no aparece en los errores).
- Relay: `signer` y cabeceras `x-signature`/`x-key-id`. Consumidores (projector —también su CLI de reproceso—, notifier, auditor y los dos del decisor): `verify` desde el entorno; fallo → `poison`.
- DLQ: `signature` y `keyId` opcionales en el mensaje; el reproceso (D7) los vuelve a poner como cabeceras.
- `scripts/generate-keys.mjs` (+ `make demo`): claves de desarrollo en dos archivos ignorados por git; el compose da la privada solo al relay y activa `enforce` con `EVENT_SIGNING_REQUIRED_FROM` = instante de generación, de modo que el historial previo no se rechaza. El job `demo` de la CI recorre así todo el flujo con firma obligatoria.
- 9 pruebas de integración (`signing.int.test.ts`), repetidas 3 veces en verde.
- Límite documentado (ADR-0012): la fecha de un mensaje sin firma la declara el propio mensaje; el corte es una ayuda de migración, no una defensa, y debe quitarse cuando el historial esté sellado.
