---
name: prd-to-backlog
description: "Convierte docs/product/PRD.md (+ scope.md, business-rules.md) en un backlog de Epics/Tasks con grafo de dependencias y un tier de riesgo/confianza por tarea. Triggers: 'desglosá el PRD', 'generá el backlog', 'convertí este PRD en epics y tareas'. Agnóstico de stack: detecta el lenguaje/framework del proyecto por su manifest antes de asumir nada sobre 'esto ya existe'."
---

# PRD → backlog de Epics/Tasks

Un PRD es prosa; un backlog son unidades construibles y ordenadas por
dependencia. Esta skill hace esa conversión y — lo más importante — etiqueta
cada tarea con cuánto riesgo de requisitos carga, para que `sprint-roadmap`
pueda priorizar después por certeza, no solo por tamaño.

## Paso 1 — Leer los docs de producto

Leer, en orden: `docs/product/PRD.md`, `docs/product/scope.md`,
`docs/product/business-rules.md`, y la cola de `docs/decisions/LOG.md` (un
`DEC-###` más nuevo pisa a la prosa del PRD sobre el mismo tema).

Si alguno de estos sigue siendo la plantilla vacía, parar y decirlo — no
inventar un backlog de la nada.

## Paso 2 — Detectar el stack

Antes de asumir que algo es "nativo" o "net-new", averiguar qué es el
proyecto de verdad. Buscar, en este orden, el que exista en la raíz del repo:
`package.json`, `requirements.txt`/`pyproject.toml`, `go.mod`, `Gemfile`,
`composer.json`, `pom.xml`/`build.gradle`. Anotar el framework y cualquier
plataforma de más alto nivel sobre la que esté construido (un CMS, una base
low-code, un starter kit) — eso determina qué cuenta como "la plataforma lo da
gratis" vs. "genuinamente net-new" en el Paso 3.

## Paso 3 — Desglosar en Epics y Tasks

Agrupar por área funcional (Epic). Dentro de cada Epic, listar tareas con:

- **ID** — corto, estable (ej. `A3`, `B12`).
- **Tarea** — una línea, imperativa.
- **Tier** — la señal de riesgo/confianza, no la de esfuerzo:
  - 🟢 **nativo/config** — el stack/plataforma ya lo hace; setup fino.
  - 🟡 **net-new, validado** — no hay código todavía, pero hay una referencia
    (un mockup aprobado, un prototipo funcionando, una spec que un stakeholder
    firmó) que prueba que el comportamiento es el correcto. Esfuerzo real,
    riesgo de requisitos ~cero.
  - 🔴 **net-new, sin diseñar** — genuinamente abierto, sin mecanismo confirmado.
  - 🛑 **bloqueado** — no puede arrancar hasta que una decisión o respuesta de
    stakeholder nombrada llegue. Nombrar el bloqueo.
- **Depende de** — otros IDs de tarea, o una precondición del repo ("entorno
  limpio existe").

Casi toda cadena arranca en un "Epic 0 — Entorno" temprano (clonar/setup) y en
el modelo de datos fundacional que el dominio necesite (un análogo de "Epic A").

## Paso 4 — Sacar a la luz las preguntas abiertas

Todo lo que etiquetaste 🛑 necesita una pregunta nombrada. Juntarlas al final
del archivo de backlog bajo "Preguntas abiertas", cada una con qué desbloquea
(SP directo + cascada, una vez que `sprint-roadmap` corrió y se conocen los
SP). Reflejar también las preguntas genuinamente nuevas en
`docs/decisions/LOG.md` como entrada pendiente si el proyecto usa esa
convención.

## Salida

Escribir en `docs/planning/<YYYY-MM-DD> - Backlog-Epics-Tasks.md` usando
`_templates/epic-task-backlog.template.md`. Nunca sobrescribir un archivo
fechado anterior — cada corrida es un snapshot nuevo.
