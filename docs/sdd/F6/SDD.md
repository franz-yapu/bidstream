# SDD — F6 · Auditoría de dependencias y actualizaciones automáticas

- **Ticket:** ClickUp **F6** (`868mvty1c`, https://app.clickup.com/t/868mvty1c).
- **Autor:** generado con Claude (Entregable 1).
- **Estado:** Implementado (2026-11-13) — aprobado el mismo día
- **Versión:** 1.0 · **Fecha:** 2026-11-13
- **Fuentes de verdad citadas:**
  1. `docs/product/bidstream_spec.md` §8 A06 ("`npm audit` en CI y actualizaciones automáticas de dependencias"), A08 (integridad), §10 (CI)
  2. `docs/sdd/0.3/SDD.md` (CI base, acciones fijadas por SHA, permisos mínimos; "Dependabot las actualizará")
  3. `docs/decisions/LOG.md` — DEC-004 (`npm audit` moderado en `minimatch`, «se trata en F6»), DEC-013 (Node 22 y `@confluentinc/kafka-javascript`), E1 (`graphql` 16.x)

---

## 0 · Preguntas que el ticket pidió cerrar

| # | Pregunta del ticket | Respuesta |
|---|---|---|
| 1 | ¿Qué política de `npm audit`? | Bloquear por **cualquier** aviso en producción y por **alto o crítico** en cualquier parte; informar el resto (§2.1) |

---

## 1 · Alcance

### Entra

- **Auditoría en CI** en un flujo propio (`security.yml`): en cada PR, en cada *push* a `main` y **semanalmente** (los avisos aparecen sin que cambie el código).
- **Dependabot** para `npm` y para `github-actions`, con agrupación, límites y mensajes compatibles con commitlint.
- Resolver los 10 avisos actuales (todos de desarrollo, por `minimatch`) o dejar su aceptación documentada.
- `npm audit signatures` (verifica las firmas del registro).
- **Pruebas de política** que impiden regresiones: todas las acciones fijadas por SHA, existencia y forma de la configuración de Dependabot y del flujo de auditoría.
- Sección «Seguridad de dependencias» en el README.

### No entra (a propósito)

- `SECURITY.md` y el mapeo OWASP completo → F5.
- Análisis estático del código (CodeQL) y escaneo de imágenes de contenedor → posible evolución con H2.
- Combinación automática (*auto-merge*) de las PR de Dependabot: se revisan a mano.
- Gestión de secretos.

### Premisas verificadas (heredadas de `task-brief`)

| Premisa del ticket | Qué hay de verdad |
|---|---|
| "Hoy hay un aviso moderado de `minimatch`" | `npm audit` da **10 avisos, todos moderados y todos de desarrollo**: `minimatch` 10.2.6 (afectado en el rango 7.0.0–11.0.0, DoS por amplificación de *globparts*, GHSA-g3hv-75wg-m249) arrastra a `@eslint/config-array`, `eslint`, `typescript-eslint` y sus subpaquetes. **En producción: 0** |
| Arreglo | `npm audit fix --force` propone bajar `eslint` a 9.39.5 (cambio mayor); pero existe `minimatch` **11.0.8** (corregida) y ya está en el árbol por otra ruta: un `overrides` podría bastar. Hay que comprobar que ESLint y `typescript-eslint` funcionan con ella |
| Acciones de GitHub | Fijadas por SHA con el comentario de versión (0.3); Dependabot sabe actualizar ese formato |
| CI | Solo existe `ci.yml` (`check` e `integration`); no hay auditoría ni `dependabot.yml` |
| Versiones que **no** deben subir solas | Node 22 (`@types/node` 22), `graphql` 16.x (decisión de E1), Prisma 7 (la 8 es candidata a versión), y `@confluentinc/kafka-javascript` no compila en Node 26 |

---

## 2 · Diseño técnico

### 2.1 Política de auditoría

| Qué | Condición | Efecto |
|---|---|---|
| Dependencias de **producción** (`--omit=dev`) | cualquier aviso (nivel `low` o superior) | **Falla el flujo**: es código que se ejecuta en producción |
| **Todas** las dependencias | `high` o `critical` | **Falla el flujo** |
| Resto (avisos moderados/bajos solo de desarrollo) | — | Se **informan** en el resumen del job, sin bloquear |
| Firmas del registro | `npm audit signatures` | Falla si una firma no verifica |

Hoy la política pasa (producción: 0 avisos). El objetivo es que un aviso futuro en una dependencia de ejecución **no pueda pasar inadvertido**.

### 2.2 Flujo `security.yml`

```yaml
on: { pull_request, push: { branches: [main] }, schedule: [{ cron: '17 6 * * 1' }], workflow_dispatch }
permissions: { contents: read }
jobs:
  audit:    # npm ci → audit producción → audit alto → audit signatures → resumen informativo
```

El *cron* semanal garantiza que un aviso nuevo se vea aunque nadie toque el repositorio. No es un *check* requerido de `main` al principio (como `integration`, §7 #3).

### 2.3 Dependabot

| Ecosistema | Frecuencia | Agrupación | Límite |
|---|---|---|---:|
| `npm` (raíz, cubre los *workspaces* por el único `package-lock.json`) | semanal (lunes) | **una PR** con las actualizaciones menores y de parche de desarrollo y **otra** con las de producción; las **mayores** van cada una en su PR | 5 |
| `github-actions` | semanal | una PR con todas | 3 |

Mensajes `chore(deps): …` / `chore(deps-dev): …` con el prefijo de commitlint. **Ignoradas** a propósito: `@types/node` por encima de 22, `graphql` por encima de 16, `prisma` y `@prisma/*` por encima de 7, y `@confluentinc/kafka-javascript` mayor (cada una con su motivo en un comentario).

### 2.4 Los avisos actuales (`minimatch`)

Intento en este orden y se registra el resultado:
1. `overrides: { "minimatch": "^11.0.8" }` en el `package.json` raíz y comprobar `npm run check` completo (ESLint y `typescript-eslint` ejercitados sobre todo el repositorio).
2. Si algo falla, **no se fuerza**: se acepta el riesgo con motivo y fecha de revisión (es una dependencia de desarrollo, el DoS necesita patrones de *glob* maliciosos que aquí no existen) y se enlaza a la actualización de ESLint cuando la corrija.

### 2.5 Pruebas de política

Un test que lee `.github/` y verifica: (a) **toda** línea `uses:` de todos los flujos está fijada por SHA de 40 hexadecimales; (b) `dependabot.yml` declara `npm` y `github-actions` con frecuencia, agrupación y prefijo de commit válido; (c) `security.yml` contiene las órdenes de auditoría de §2.1 y el `schedule`; (d) los permisos de cada flujo son de lectura. Es una barrera contra regresiones (A06/A08), no una prueba del servicio de Dependabot.

---

## 3 · Cambios por archivo/módulo

| Archivo/módulo | Cambio |
|---|---|
| `.github/workflows/security.yml` | Nuevo: auditoría de §2.2 |
| `.github/dependabot.yml` | Nuevo: §2.3 |
| `package.json` (raíz) | `overrides` de `minimatch` si el intento de §2.4 pasa; scripts `audit:prod` y `audit:high` para ejecutar la misma política en local |
| `packages/testing/src/policy/repo-policy.test.ts` | Pruebas de §2.5 |
| `package.json` (raíz, devDependencies) | Analizador de YAML (`yaml`) para las pruebas |
| `README.md`, `CLAUDE.md` | Sección de seguridad de dependencias y cómo ejecutar la auditoría |
| `docs/decisions/LOG.md` | Resultado del intento de `overrides` |

---

## 4 · Plan de tests

| Caso | Nivel | Cubre |
|---|---|---|
| Todas las acciones de todos los flujos están fijadas por SHA de 40 hexadecimales | unit (política) | A06/A08 |
| `dependabot.yml` declara `npm` y `github-actions`, semanal, con agrupación y prefijo `chore` | unit | Configuración |
| `security.yml` incluye `npm audit --omit=dev`, `npm audit --audit-level=high`, `npm audit signatures`, el `schedule` y permisos de solo lectura | unit | Política |
| Ningún flujo concede permisos de escritura salvo los declarados | unit | Mínimo privilegio |
| `npm run audit:prod` y `audit:high` terminan con 0 en el estado actual | integración (local) | La política pasa |
| En un PR real el flujo `security` se ejecuta y termina en verde | CI | Pipeline |
| **Falla de verdad:** una rama descartable que añade a producción una dependencia con un aviso conocido hace fallar el flujo (PR descartable, se cierra) | CI | La política bloquea |
| Tras el `overrides`, `npm run check` y `npm run test:integration` siguen en verde (o el riesgo queda documentado) | integración | Sin regresión |
| `npm audit` informa 0 avisos moderados tras el `overrides` (o los 10 quedan documentados como aceptados) | integración | Resultado |

**Deliberadamente sin test:** que Dependabot abra PR (lo hace el servicio de GitHub; se verifica al cabo de una semana).

---

## 5 · Definition of Done

- [x] SDD en `docs/sdd/F6/SDD.md`, Estado = Aprobado
- [x] `security.yml` y `dependabot.yml` activos; el flujo pasa y se comprueba que **falla** con un aviso en producción
- [x] Los 10 avisos actuales resueltos o aceptados con motivo y fecha
- [x] Pruebas de política en verde (acciones fijadas por SHA)
- [x] README documenta la política
- [x] Tests del §4 en verde; `npm run check` y `npm run test:integration` en verde
- [x] PR con CI verde y fusionado

---

## 6 · Riesgos

| Riesgo | Gravedad | Mitigación |
|---|---|---|
| Forzar `minimatch` 11 rompe ESLint o `typescript-eslint` de forma sutil | Media | `npm run check` completo sobre todo el repositorio antes de aceptar; si falla, no se fuerza |
| Dependabot abre demasiadas PR y se ignoran | Media | Agrupación y límite de 5; las mayores van solas |
| Una actualización automática rompe la compatibilidad con Node 22 o con el cliente de Kafka | Media | Ignorar las versiones mayores problemáticas, y la CI completa (con integración) decide cada PR |
| Un aviso sin parche en producción bloquea todos los PR | Media | Mecanismo de excepción temporal documentado (con motivo y fecha) en lugar de desactivar el flujo |
| `npm audit` depende de un servicio externo y puede fallar por red | Baja | Reintento del job; no es *check* requerido al principio |
| Falsa sensación de seguridad: `npm audit` no ve todo | Media | Se declara en el README; F5/H2 añaden más capas |

---

## 7 · Preguntas abiertas

1. **Política:** bloquear por cualquier aviso en producción y por alto/crítico en todo (propuesta). ¿De acuerdo?
2. **`overrides` de `minimatch`** a ^11.0.8 si ESLint y `typescript-eslint` siguen funcionando (propuesta); si no, aceptar el riesgo con motivo y fecha. ¿De acuerdo?
3. **El flujo `security` no es *check* requerido** al principio y se exige tras una semana estable (como `integration`). ¿De acuerdo?
4. **Ignorar las versiones mayores** de `@types/node` (22), `graphql` (16), Prisma (7) y `@confluentinc/kafka-javascript`. ¿Alguna otra?
5. **Revisión de la acción `dependency-review`** para las PR (bloquea al añadir dependencias vulnerables) como evolución, no ahora. ¿De acuerdo?

---

## Changelog de implementación

- **Implementado (2026-11-13)** con todas las propuestas aprobadas de §7: política «cualquier aviso en producción o alto/crítico en todo», `overrides` de `minimatch` si el gate lo soporta, el flujo `security` fuera de los checks requeridos al principio, versiones mayores ignoradas (`@types/node`, `graphql`, `prisma`, `@prisma/*`, `@confluentinc/kafka-javascript`) y `dependency-review` como evolución.
- **Resultado del `overrides`:** `"minimatch": "^11.0.8"` en el `package.json` raíz. El árbol pasa a usar solo la 11.0.8 y `npm audit` baja de **10 avisos moderados a 0**. Comprobado con el gate completo (compilación, tipos, ESLint sobre todo el repositorio, formato, 238 pruebas unitarias) y las **190 de integración**: sin regresiones. No hubo que aceptar ningún riesgo.
- `.github/workflows/security.yml`: auditoría de producción (`--audit-level=low`), de todo (`--audit-level=high`), `npm audit signatures` y un resumen informativo; en cada PR, en `main`, semanal (lunes 06:17 UTC) y manual. `npm ci --ignore-scripts` (la auditoría no compila binarios).
- `.github/dependabot.yml`: `npm` y `github-actions`, semanal, agrupado (desarrollo y producción por separado, y todas las acciones juntas), límite de 5 y 3 PR y mensajes `chore(deps)` / `chore(deps-dev)` compatibles con commitlint.
- Scripts `audit:prod` y `audit:high` para ejecutar la misma política en local.
- 21 pruebas de política (`packages/testing/src/policy/repo-policy.test.ts`): toda acción fijada por SHA de 40 hexadecimales, permisos de solo lectura, ningún `pull_request_target`, el contenido del flujo de auditoría, la configuración de Dependabot (incluidas las versiones mayores ignoradas), coherencia de Node 22 y que el `overrides` de `minimatch` siga vigente y reflejado en el *lockfile*.
- La prueba de que el flujo **falla de verdad** con un aviso en producción se hizo con un PR descartable (ver el registro en `docs/decisions/LOG.md`, DEC-038).
- **Fallo real encontrado en la CI:** `npm audit signatures` con el npm 10.9.9 de Node 22 fallaba con `EMISSINGSIGNATUREKEY` en `es-toolkit@1.53.2` (tiene atestaciones pero npm no halla la clave pública: raíz de confianza de Sigstore antigua). Era determinista en GitHub y pasaba en local (donde el resultado es 458 paquetes con firmas verificadas y 171 atestaciones). Se usa **`npx npm@11.21.2`** (versión exacta, no flotante) solo en ese paso; con npm 11 también pasa. Una prueba exige que el npm esté fijado.
- Pendiente de comprobar con el tiempo: que Dependabot abra su primera PR (lo hace el servicio de GitHub, se verá el lunes).
