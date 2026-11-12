---
name: ticket-cards
description: "Convierte las tareas del último roadmap de sprint en tickets listos para crear en el tracker (título, cuerpo, tamaño) y los pushea vía el adaptador de tracker configurado. Triggers: 'creá los tickets', 'armá las tarjetas de este sprint', 'pusheá esto al tracker'. Depende de que sprint-roadmap haya corrido."
---

# Roadmap → tickets del tracker

Un ticket por unidad entregable, del tamaño justo para revisar de una
sentada (la convención de Casper era ≤8 story points — ajustalo a la norma
del equipo, pero elegí un número y quedate por debajo; partí lo que sea más
grande).

## Paso 1 — Elegir el lote

Del `docs/planning/*-Sprint-Roadmap.md` más reciente, tomar las tareas que
todavía no tienen ticket (columna `Ticket` vacía) de la(s) ola(s) que el
usuario pida.

## Paso 2 — Escribir el cuerpo de cada ticket

Usar `_templates/ticket-card.template.json`. Cada cuerpo necesita:

- **Título** — `[TIPO] Módulo: descripción corta`.
- **Explicación** — por qué importa, en lenguaje llano, un párrafo.
- **Qué construir** — el comportamiento concreto, citando rutas de archivo /
  funciones exactas del repo cuando ya existe un mecanismo y no hay que
  reconstruirlo (decirlo explícito — reusar un helper existente vale la pena
  mencionarlo antes de que alguien lo reinvente).
- **Orden de entregables, bloqueante y explícito en la tarjeta** — no alcanza
  con listarlos, cada uno tiene que decir que bloquea al siguiente:
  1. **SDD aprobado** (`write-sdd`, en `docs/sdd/<ID>/SDD.md`, Estado =
     `Aprobado (fecha)`). Nadie escribe código de este ticket hasta que esto
     esté aprobado.
  2. **Implementación según ese SDD.** Si algo no calza durante el código, se
     vuelve al SDD (revisión nueva versionada), no se improvisa por fuera de
     lo aprobado.
  3. **Tests del plan que el SDD dejó en su §4**, corriendo y en verde. Un
     ticket sin los tests que su propio SDD prometió no está terminado,
     aunque el código funcione.
  4. **Quality gate del proyecto** (lo que el repo use: typecheck/lint/tests/
     build), en verde.
- **Definition of Done** — un checklist que refleje ese mismo orden punto por
  punto, específico de este ticket (no genérico). Ver
  `_templates/ticket-card.template.json` para el texto exacto a reusar.
- **Referencias** — el ID de tarea del backlog, el archivo de roadmap,
  secciones relevantes del PRD/ADR.

No inventar los IDs de custom fields del tracker — leerlos de la config del
adaptador o consultarlos en vivo; un ID equivocado falla en silencio.

## Paso 3 — Pushear

Usar el adaptador de tracker en `scripts/tracker/` (ver su README para qué
trackers tienen adaptador listo). Confirmar con el usuario el destino
(lista/board/proyecto) y el asignado por defecto antes de pushear un lote —
es una acción visible en el tracker y semi-irreversible (borrar tickets
creados es limpieza manual), así que no pushear sin una confirmación rápida
en el primer lote de un proyecto nuevo.

## Paso 4 — Registrar

Actualizar la columna `Ticket` del roadmap con los IDs nuevos para que la
próxima corrida de `sprint-roadmap` no los recree.
