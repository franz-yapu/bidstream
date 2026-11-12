---
name: prd-to-tickets
description: "Corre el método completo de punta a punta en una sola invocación: prd-to-backlog → sprint-roadmap → ticket-cards. Triggers: 'corré el método completo', 'planificá todo el proyecto', 'de PRD a tickets', 'automatizá el pipeline', 'armá el sprint entero'. Para el primer uso en un proyecto nuevo, o para refrescar todo de punta a punta cuando el PRD cambió. Sigue pidiendo confirmación antes de pushear tickets al tracker — 'automático' significa no repreguntar en cada paso de generación de docs, no saltarse el único paso con efecto visible fuera del repo."
---

# PRD → tickets, de punta a punta en una corrida

Encadena las tres skills de planificación sin que el usuario tenga que
invocarlas una por una. Es azúcar sintáctica sobre `prd-to-backlog` +
`sprint-roadmap` + `ticket-cards` — no reemplaza su lógica, solo evita el
ida-y-vuelta manual cuando alguien quiere la foto completa de un saque.

## Cuándo usar esto vs. las skills sueltas

- **Usar esto:** primera corrida de un proyecto con un PRD nuevo, o cuando se
  quiere refrescar todo de punta a punta porque el PRD cambió.
- **Usar las skills sueltas:** cuando solo cambió un tramo. Si el PRD no se
  tocó pero el repo avanzó, alcanza con re-correr `sprint-roadmap` solo — no
  hace falta regenerar el backlog ni los tickets.

## Paso 0 — Chequeo de que vale la pena correr esto

Antes de arrancar, comparar `docs/product/PRD.md` (+ `scope.md` +
`business-rules.md`) contra la fecha/estado del `docs/planning/*-Sprint-Roadmap.md`
más reciente (si existe alguno). **No comparar el hash de commit crudo** —
el repo se mueve por razones que no tocan al producto (tests, docs internos,
la config del propio kit), y comparar HEAD contra HEAD da falsos positivos.
Comparar en cambio `git diff <hash citado en el roadmap> HEAD -- docs/product/
<rutas de código fuente de la app, no de este kit>`: si ese diff acotado está
vacío y el PRD tampoco cambió, avisar que no hay nada nuevo y ofrecer correr
solo `sprint-roadmap` en vez de todo el pipeline — no generar un duplicado del
mismo día por las dudas.

Si `docs/product/PRD.md` sigue siendo la plantilla vacía, parar acá. No hay
de dónde derivar nada.

## Paso 1 — `prd-to-backlog`

Correr la skill completa tal cual está documentada en
`.claude/skills/prd-to-backlog/SKILL.md`: leer PRD + scope + business-rules +
log de decisiones, detectar el stack, desglosar en Epics/Tasks con tier
🟢🟡🔴🛑, escribir `docs/planning/<fecha> - Backlog-Epics-Tasks.md`.

## Paso 2 — `sprint-roadmap`

Correr `.claude/skills/sprint-roadmap/SKILL.md` sobre el backlog recién
generado: cruzar contra el repo real y el board del tracker, ordenar en las
cuatro olas, escribir `docs/planning/<fecha> - Sprint-Roadmap.md`.

## Paso 3 — `ticket-cards` para la Ola 1

Correr `.claude/skills/ticket-cards/SKILL.md` tomando **solo la Ola 1**
(llave/barata) del roadmap recién generado — no todo el backlog de una vez.
Generar los cuerpos JSON en `docs/planning/<fecha>-tickets/`.

Las olas 2, 3 y 4 quedan documentadas en el roadmap pero sin tickets creados
todavía — se piden aparte ("ahora armame los tickets de la ola 2") cuando el
equipo esté por arrancarlas. Cargar tickets de trabajo que falta mucho para
empezar ensucia el tracker con ruido que nadie va a mirar a tiempo.

## Paso 4 — Confirmar antes de pushear (obligatorio, no se salta)

Este es el único paso con efecto visible fuera del repo: crea tickets reales
que otras personas van a ver en el tracker. Antes de correr `create` por cada
uno:

1. Mostrar un resumen: cuántos tickets, a qué lista/proyecto del tracker, con
   qué asignado por defecto.
2. Esperar una confirmación explícita del usuario.
3. Recién ahí pushear, uno por uno, con el adaptador de `scripts/tracker/`.

"Automático" en el pedido del usuario se interpreta como *no repreguntar en
cada paso de generación de documentos* (pasos 1-3 corren seguidos, sin pausa),
**no** como saltarse esta confirmación — crear tickets en un tracker
compartido es una acción semi-irreversible y visible para terceros.

## Paso 5 — Registrar y cerrar

Actualizar la columna `Ticket` del roadmap con los IDs devueltos por el
tracker (igual que el Paso 4 de `ticket-cards`).

Cerrar con un resumen corto en el chat: cuántos Epics y tareas salieron del
backlog, tamaño de cada ola, cuántos tickets se crearon (o se generaron sin
pushear, si no hubo confirmación), y un recordatorio de que `task-brief` se
corre aparte, ticket por ticket, justo antes de que alguien arranque a
codearlo — no es parte de este pipeline.
