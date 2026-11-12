# SDD — 0.3 · CI base en GitHub Actions

- **Ticket:** ClickUp **0.3** (`868mvtfpx`, https://app.clickup.com/t/868mvtfpx).
- **Autor:** generado con Claude (Entregable 1).
- **Estado:** Implementado (2026-11-12) — aprobado el mismo día
- **Versión:** 1.0 · **Fecha:** 2026-11-12
- **Fuentes de verdad citadas:**
  1. `docs/product/bidstream_spec.md` §1 (Agile: "PR con CI obligatoria"), §10 (CI: typecheck, lint, pruebas, build, auditoría)
  2. `docs/sdd/0.1/SDD.md` §2.3 (script `check` = quality gate)
  3. `docs/product/bidstream_spec.md` §8 A06 (auditoría en CI → ticket F6)

---

## 1 · Alcance

### Entra

- Workflow `.github/workflows/ci.yml` que en cada PR y en cada push a `main` ejecuta `npm ci` y `npm run check` (typecheck, lint, formato, tests, build) en Node 22.
- Acciones de terceros fijadas por **SHA de commit** (no por etiqueta móvil).
- Permisos mínimos (`contents: read`) y cancelación de ejecuciones obsoletas.
- Insignia del estado de la CI en el `README.md`.
- Proteger `main` exigiendo la CI (ver §2.3; requiere tu confirmación).

### No entra (a propósito)

- `npm audit` y Dependabot → F6 (el workflow queda con un paso fácil de añadir).
- Pruebas de integración con Kafka/Postgres → G1 (llegarán como job aparte con servicios de contenedor).
- Despliegue o publicación de imágenes → H2/H3.
- Matriz de versiones de Node: solo la 22, la que fija `.nvmrc`.

### Premisas verificadas (heredadas de `task-brief`)

| Premisa del ticket | Qué hay de verdad |
|---|---|
| "Typecheck, lint, test, build en cada PR" | Existe `npm run check` que los encadena (más `format:check`); no existe `.github/` |
| Repo remoto | `github.com/franz-yapu/bidstream` público, `main` subido hoy; sin Actions ni protecciones |
| Versiones de acciones | `actions/checkout` v7.0.1 y `actions/setup-node` v7.1.0 (SHAs resueltos con `gh api`) |

---

## 2 · Diseño técnico

### 2.1 Workflow

```yaml
name: CI
on:
  pull_request:
  push:
    branches: [main]
permissions:
  contents: read
concurrency:
  group: ci-${{ github.ref }}
  cancel-in-progress: true
jobs:
  check:
    runs-on: ubuntu-latest
    timeout-minutes: 10
    steps:
      - uses: actions/checkout@3d3c42e5aac5ba805825da76410c181273ba90b1 # v7.0.1
      - uses: actions/setup-node@949feb2413d6458794dcd2491c4babbbce0c15c1 # v7.1.0
        with:
          node-version-file: .nvmrc
          cache: npm
      - run: npm ci
      - run: npm run check
```

### 2.2 Decisiones y por qué

| Decisión | Elección | Por qué |
|---|---|---|
| Un solo job `check` que llama a `npm run check` | Misma orden que usa quien desarrolla | Una sola definición del quality gate; la CI no puede divergir de lo local |
| Node desde `.nvmrc` | `node-version-file: .nvmrc` | Una única fuente de la versión (22) |
| Acciones por SHA | SHA + comentario con la versión | OWASP A06/A08: una etiqueta puede reapuntarse; el SHA no. Dependabot (F6) las actualizará |
| `permissions: contents: read` | Mínimo privilegio | Un workflow comprometido no puede escribir en el repo |
| `pull_request` (no `pull_request_target`) | Sin acceso a secretos desde forks | Evita ejecutar código no confiable con permisos |
| `timeout-minutes: 10` | Límite explícito | Evita ejecuciones colgadas que consuman minutos |

### 2.3 Protección de `main` (acción visible en GitHub)

Tras la primera ejecución verde, activar protección de rama: PR obligatoria y el check `check` requerido, sin permitir *force push*. Se hace con `gh api` y **solo con tu confirmación**, porque cambia cómo puedes subir a `main`. Hasta entonces, `main` sigue aceptando pushes directos.

---

## 3 · Cambios por archivo/módulo

| Archivo/módulo | Cambio |
|---|---|
| `.github/workflows/ci.yml` | Nuevo, según §2.1 |
| `README.md` | Insignia de CI |
| `CLAUDE.md` | Nota: la CI ejecuta `npm run check`; las acciones se fijan por SHA |
| GitHub (ajuste del repo) | Protección de `main` (§2.3), con confirmación |

---

## 4 · Plan de tests

| Caso | Nivel | Cubre |
|---|---|---|
| El push de la rama de trabajo dispara el workflow y termina en verde | integración (en GitHub) | Pipeline completo en Node 22 |
| Una rama de prueba con un error de lint deliberado hace fallar el job (se descarta) | integración | La CI realmente bloquea |
| El workflow no usa `pull_request_target` ni secretos | revisión | Mínimo privilegio |
| Con la protección activa, un PR con CI roja no se puede fusionar | integración | Obligatoriedad (§2.3) |

**Deliberadamente sin test:** sintaxis YAML (la valida GitHub al ejecutar).

---

## 5 · Definition of Done

- [x] SDD en `docs/sdd/0.3/SDD.md`, Estado = Aprobado
- [x] CI verde en un PR real hacia `main`
- [x] Falla comprobada con un error deliberado (rama descartada)
- [x] Acciones fijadas por SHA, permisos mínimos
- [x] Insignia en el README
- [x] Protección de `main` activa (o decisión registrada de dejarla para después)
- [x] Commit con conventional commits

---

## 6 · Riesgos

| Riesgo | Gravedad | Mitigación |
|---|---|---|
| La CI da falsos rojos por diferencias de Node (local 26, CI 22) | Media | CI en 22 es la verdad; `engine-strict` ya activo |
| Proteger `main` te bloquea pushes directos | Baja | Flujo con ramas + PR, que es lo que pide la spec; se hace con tu confirmación |
| SHA fijado queda desactualizado | Baja | Dependabot en F6 |

---

## 7 · Preguntas abiertas

1. ¿Activo la protección de `main` (PR obligatoria + CI requerida) al terminar? Propuesta: sí, y aprobar los PR propios con la CI como único requisito (sin revisor obligatorio, eres la única persona).

---

## Changelog de implementación

- **Implementado (2026-11-12):** workflow según §2.1, acciones por SHA (`actions/checkout` v7.0.1, `actions/setup-node` v7.1.0). PR #1: CI verde en 47 s.
- Comprobado el caso de fallo: PR descartable #2 con un `any` explícito → el job `check` falló en 31 s (lint). PR cerrado y rama borrada.
- Protección de `main` activada tras fusionar (PR obligatoria + check `check` requerido, sin force push), con la confirmación de §7 #1.
