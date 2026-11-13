# SDD — F5 · `SECURITY.md` con el mapeo OWASP Top 10

- **Ticket:** ClickUp **F5** (`868mw4qtv`, https://app.clickup.com/t/868mw4qtv).
- **Autor:** generado con Claude (Entregable 1).
- **Estado:** Borrador (2026-11-13) — implementado a la espera de tu aprobación (el PR no se fusiona hasta entonces)
- **Versión:** 0.1 · **Fecha:** 2026-11-13
- **Fuentes de verdad citadas:** `docs/product/bidstream_spec.md` §8 («un archivo propio que recorra el Top 10 y diga qué hiciste para cada punto»); ADR 0001–0013; SDD de F1, F2, F3, F4, F6, H2; las pruebas que respaldan cada control.

---

## 0 · Preguntas que el ticket pidió cerrar

| # | Pregunta | Respuesta |
|---|---|---|
| 1 | ¿Qué debe decir cada punto? | Qué control existe, **dónde está** y **qué prueba lo demuestra**; y qué **no** está hecho todavía |
| 2 | ¿Dónde vive? | `SECURITY.md` en la raíz (GitHub lo muestra en la pestaña «Security») |

---

## 1 · Alcance

### Entra

- `SECURITY.md`: política de reporte de vulnerabilidades, modelo de amenazas breve (fronteras de confianza), **tabla A01–A10** (control → implementación → evidencia → estado) y una sección **«Límites conocidos y pendientes»** sin maquillar.
- Pruebas de documentación (`packages/testing/src/docs/security.test.ts`): estructura A01–A10, enlaces y rutas de evidencia que existen, y **dos comprobaciones del propio código** que respaldan afirmaciones del documento: (a) A10: ningún cliente HTTP saliente en el código de la aplicación; (b) A03: todo SQL crudo usa plantillas parametrizadas (nunca `*Unsafe`).
- Enlazar desde el README.

### No entra

- Nuevos controles (el documento refleja lo hecho; lo que falta se lista).
- Pentesting externo ni escaneo de imágenes (H1).

### Premisas verificadas

| Premisa | Qué hay de verdad |
|---|---|
| «Qué hiciste para cada punto» | A01, A03–A09 tienen controles implementados y probados (F1–F4, F6, H2, ADR); **A02 está a medias** (Argon2id y Ed25519 sí; TLS y Key Vault dependen de Azure, H1) y **A09 no tiene alertas** (H4) |
| A10 SSRF | El código no hace llamadas HTTP salientes (solo PostgreSQL y Kafka): es verificable por una búsqueda en el código |

---

## 2 · Diseño técnico

Cada punto: **Riesgo** · **Qué se hizo** (con enlaces a código y ADR) · **Evidencia** (pruebas) · **Estado** (`Hecho`, `Parcial`, `Pendiente`). Sin cifras ni afirmaciones que no estén respaldadas por una prueba o un enlace.

| Decisión | Elección | Por qué |
|---|---|---|
| Honestidad | Estados `Parcial`/`Pendiente` explícitos | Un documento de seguridad que solo dice «sí» no es creíble |
| Evidencia | Enlaces a pruebas, comprobados por test | Una afirmación sin prueba es una opinión |
| Código vigilado | Dos pruebas que escanean el repositorio | Que A10 y A03 no dejen de ser ciertos sin que se note |

---

## 3 · Cambios por archivo/módulo

| Archivo | Cambio |
|---|---|
| `SECURITY.md` (nuevo) | El documento |
| `packages/testing/src/docs/security.test.ts` (nuevo) | Pruebas de documentación y de código |
| `README.md` | Enlace y fin de «`SECURITY.md` pendiente» en «Estado y límites» |

---

## 4 · Plan de tests

| Caso | Nivel | Cubre |
|---|---|---|
| Existen A01…A10, en orden, cada uno con riesgo, control, evidencia y estado válido | documentación | Estructura |
| Todo enlace relativo existe | documentación | Enlaces |
| Todo punto `Hecho` o `Parcial` enlaza al menos una prueba (`*.test.ts`) y a código o ADR | documentación | Evidencia |
| Hay sección de límites conocidos y reporte de vulnerabilidades | documentación | Política |
| Ningún archivo de la aplicación (excluidas pruebas y scripts) usa `fetch(`, `axios`, `undici`, `http.request/get` | código | A10 |
| Ningún SQL crudo usa `$queryRawUnsafe` ni `$executeRawUnsafe` | código | A03 |
| El README enlaza `SECURITY.md` | documentación | Descubrimiento |

---

## 5 · Definition of Done

- [ ] SDD Aprobado; `SECURITY.md`; pruebas del §4; `npm run check` en verde; PR con CI verde y fusionado

## 6 · Riesgos

| Riesgo | Gravedad | Mitigación |
|---|---|---|
| El documento envejece | Media | Pruebas que verifican enlaces y rutas |
| Exagerar un control | Alta | Estados explícitos y evidencia obligatoria |

## 7 · Preguntas abiertas

1. **Política de reporte:** GitHub «Report a vulnerability» (privado) en lugar de un correo (propuesta, para no publicar datos personales). ¿Bien?
2. **Sin SLA numérico** de respuesta (es un proyecto personal). ¿O prefieres uno?
