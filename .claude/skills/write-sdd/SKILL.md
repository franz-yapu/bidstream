---
name: write-sdd
description: "Genera el Solution/Design Document (SDD) de un ticket — el Entregable 1 antes de codear. Construye sobre lo que ya encontró task-brief (premisas verificadas, resumen, diagrama) y lo convierte en un documento de diseño formal: alcance, decisiones técnicas, plan de cambios por archivo, tests, DoD, riesgos y preguntas abiertas. Triggers: 'hacé el SDD', 'escribí el doc de diseño de TICKET-ID', 'generá el SDD'. Corre después de task-brief, no lo reemplaza. Todo queda local — esta skill nunca sube nada a un tracker ni a un drive."
---

# SDD — documento de diseño antes de codear

Un ticket dice qué hay que lograr. Un SDD dice **cómo**, con el detalle
suficiente para que alguien sin el contexto de esta conversación pueda
implementarlo sin volver a tomar decisiones de diseño — y para que dentro de
tres meses, cuando nadie se acuerde de por qué se hizo así, el documento
todavía explique el porqué.

## Cuándo usar esto vs. `task-brief`

- **`task-brief`** es el chequeo rápido: verifica premisas contra el repo,
  entrega un resumen corto + un diagrama de flujo, listo en minutos. Sirve
  para decidir si vale la pena seguir con el ticket tal como está escrito.
- **`write-sdd`** es el entregable formal: un documento versionado que queda
  citado desde el ticket y desde `docs/decisions/LOG.md`.
- **Correr `task-brief` primero, siempre.** Si encontró premisas que no se
  sostienen, el SDD las hereda en su §1 tal cual — no las re-verifica de cero.

## Estructura

Usar `_templates/sdd.template.md`. Seis reglas sobre cómo llenarlo:

**Header** — ticket (id + link), estado (`Borrador` | `Aprobado (fecha)` |
`Implementado (fecha)`), versión, y las fuentes de verdad citadas con
sección/fecha puntual (`docs/product/PRD.md §Requisitos funcionales #3`, no
solo "el PRD").

**§0 — Preguntas que el ticket pidió cerrar.** Solo si el ticket lista
decisiones explícitas. Tabla pregunta → respuesta corta, detalle en el cuerpo.

**§1 — Alcance.** Qué entra, qué no entra, y la tabla de premisas heredada de
`task-brief` (qué decía el ticket vs. qué hay de verdad en el repo).

**§2 — Diseño técnico.** La forma concreta de resolverlo: contratos de
API/función, forma de los datos, decisiones de arquitectura **y por qué** —
no alcanza con el qué, un SDD sin el porqué es indistinguible de un README.

**§3 — Cambios por archivo/módulo.** Lista concreta y accionable: qué se
agrega, qué se modifica. El nivel de detalle correcto es "alguien lo
implementa sin decidir nada de diseño nuevo en el camino".

**§4 — Plan de tests.** Qué casos, a qué nivel (unit/integration/e2e), y qué
deliberadamente no se testea y por qué no.

**§5 — Definition of Done.** Checklist específico de este ticket, no genérico.

**§6 — Riesgos.** Qué puede salir mal, qué tan grave, cómo se mitiga o por
qué se decide vivir con eso.

**§7 — Preguntas abiertas.** Todo lo que no se pudo cerrar acá **no se
inventa** — va a `docs/decisions/LOG.md` como pendiente, igual que en
`prd-to-backlog` y `task-brief`.

## Reglas duras

- **Nunca reescribir un SDD aprobado para "arreglarlo".** Si algo cambió
  después de la aprobación, es una revisión nueva (versión +0.1 o +1, según
  el tamaño del cambio) con un changelog corto al pie — no una edición muda
  que borra el rastro de qué se aprobó originalmente.
- **Guardar en `docs/sdd/<TICKET-ID>/SDD.md`.** Si varios tickets comparten
  diseño, un solo SDD con el id compuesto en la carpeta
  (`docs/sdd/<ID1>-<ID2>/SDD.md`) y cada ticket individual lo referencia en
  vez de duplicar contenido.
- **Citar, no repetir.** Si algo ya está resuelto en otro SDD o en un ADR,
  linkear — la copia se desactualiza, el original no.
- **100% local.** Esta skill solo escribe el archivo en el repo. No sube nada
  a un tracker ni a un servicio externo — eso, si un proyecto lo necesita, es
  un paso aparte y explícito, nunca implícito acá.

## Salida

`docs/sdd/<TICKET-ID>/SDD.md`, usando `_templates/sdd.template.md`.
