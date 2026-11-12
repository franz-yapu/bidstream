---
name: sprint-roadmap
description: "Cruza el último backlog de Epics/Tasks contra el estado real del repo (git) y el estado del board del tracker para producir un roadmap de sprint por olas. Triggers: 'planeá el sprint', 'organizá esto en sprints', 'qué hacemos ahora', 'generá el roadmap'. Depende de que prd-to-backlog haya corrido al menos una vez."
---

# Backlog → roadmap de sprint por olas

El backlog dice qué se *podría* construir. Esta skill dice qué construir
*ahora*, cruzando tres fuentes que suelen no coincidir — el orden de
confianza importa.

## Paso 1 — Juntar las tres fuentes

1. **El backlog** — el `docs/planning/*-Backlog-Epics-Tasks.md` más reciente.
2. **El repo real** — `git log`, `git status`, y una lectura puntual del
   código que cada tarea 🟡/🔴 dice que necesita. Este es el desempate: si el
   backlog o el tracker dicen que algo está hecho y el repo no coincide,
   **gana el repo**.
3. **El board del tracker** — tickets actuales, su campo de estado, story
   points si se trackean. Los boards mienten de una forma específica:
   tarjetas "in progress" sin commits recientes, o "ready" apuntando a un
   archivo que sigue siendo un stub. Marcar esto explícitamente, no confiar
   ciegamente en el campo de estado.

## Paso 2 — Ordenar en cuatro olas

No por tamaño — por **qué está genuinamente desbloqueado y es barato de
cobrar primero**:

- **Ola 1 — llave/barata** — desbloqueado, sin dependencia de stakeholder,
  chico. Incluir cualquier tarea "llave" de la que cuelga otro trabajo
  (decirlo explícito: "N de M tareas dependen de esta").
- **Ola 2 — volumen** — desbloqueado, sin dependencia de stakeholder, pero
  más grande/más cantidad. El trabajo paralelizable va acá.
- **Ola 3 — bloqueado por un stakeholder** — ordenar por apalancamiento: SP
  desbloqueado directo + SP desbloqueado en cascada (o sea, qué más destraba),
  no solo el SP de la tarea misma.
- **Ola 4 — decisiones de alcance** — sin costo de build, llamadas puras de
  "esto entra en esta versión o no".

## Paso 3 — Escribir "qué preguntar ahora"

Una lista corta y ordenada de las preguntas reales que bloquean la Ola 3, cada
una con lo que desbloquea (SP directo + cascada) para que quien maneje la
relación con el stakeholder vea qué pregunta vale más perseguir primero. Dos o
tres preguntas suelen valer más que el resto de la lista junta — decirlo.

## Paso 4 — Salida

Escribir en `docs/planning/<YYYY-MM-DD> - Sprint-Roadmap.md` usando
`_templates/sprint-roadmap.template.md`: una tabla resumen de estado, las
cuatro olas, la tabla completa de tareas (ID, módulo, tarea, tamaño, estado,
ola, ticket, fuente, depende-de, bloqueo), y la lista de preguntas ordenada.
Diagramas mermaid para las cadenas de dependencia son opcionales pero valiosos
cuando un módulo tiene más de ~5 tareas colgando de una raíz.

Anotar el hash del commit del repo y la fecha arriba de todo — esto es un
snapshot, no una vista en vivo.
