---
name: task-brief
description: "Correr antes de arrancar cualquier ticket. Verifica cada premisa que el ticket da por hecha contra el repo real, y produce un resumen corto + diagrama de flujo de la implementación antes de pedir aprobación para codear. Triggers: 'empecemos con el ticket X', 'dame el brief de este ticket', 'escribí el doc de diseño'. Agnóstico de stack: detecta el proyecto antes de decidir cómo verificar si algo existe."
---

# Task brief — verificar premisas antes de codear

Un ticket no es la verdad — es lo que alguien creía cuando lo escribió,
filtrado además por un snapshot de roadmap que puede ya estar desactualizado.
Esta skill caza esa brecha antes de que cueste una implementación tirada a la
basura.

## Paso 1 — Leer el ticket entero

Traerlo del tracker (vía el adaptador en `scripts/tracker/`, o como funcione
el conector del tracker del proyecto). Anotar entregables y Definition of
Done — dicen si se espera un doc de diseño antes del código, y qué gates hay.

## Paso 2 — Detectar el stack (alcanza con hacerlo una vez por sesión)

Igual que el Paso 2 de `prd-to-backlog`: encontrar el manifest en la raíz del
repo para saber qué significa acá "verificar si X existe" — un modelo de
Prisma/Django/Rails, un archivo de ruta, un componente, lo que sea la
convención de este stack.

## Paso 3 — Verificar cada premisa

Por cada cosa que el ticket **da por existente** — un modelo, una ruta, un
subsistema, un documento citado — comprobarla de verdad:

```bash
# adaptar estas tres formas al stack detectado:
grep -rn "<NombreModelo>" <ubicación-de-schema-o-modelos>
find . -ipath '*<feature>*' -not -path '*/node_modules/*' -not -path '*/.git/*'
ls docs/<ruta-citada> 2>&1
```

Cuando una premisa no se sostiene, no la parchees en silencio — va en una
tabla al principio del brief: qué dice el ticket vs. qué hay de verdad. Esta
tabla suele ser la salida más valiosa de toda la skill.

## Paso 4 — Producir el brief

Dos entregables, antes de que nadie apruebe nada:

1. **Un resumen corto** — qué se construye, y explícitamente qué NO.
2. **Un diagrama de flujo** (mermaid) — las capas involucradas y la regla de
   negocio central, no un plan de implementación línea por línea.

## Paso 5 — Marcar lo que va al log de decisiones

Cualquier premisa que no se sostuvo, alcance diferido, o pregunta genuinamente
abierta que aparezca acá va a `docs/decisions/LOG.md`, no enterrada solo
dentro de un doc de diseño — decilo explícito en el chat, aunque el doc de
diseño también lo explique.
