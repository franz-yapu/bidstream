# `docs/` — convención de fuente de verdad

Esta carpeta es la fuente de verdad de planificación del proyecto. Antes de
implementar algo, leé lo relevante acá — no hace falta leerlo todo cada vez,
solo lo que toca la tarea.

## Layout

| Ruta | Qué va acá |
|---|---|
| `docs/product/PRD.md` | El documento de requisitos del producto. Capa base — qué debe hacer el producto. |
| `docs/product/scope.md` | Qué entra y qué no entra en la versión actual. |
| `docs/product/business-rules.md` | Reglas de dominio que no son obvias desde la prosa del PRD (umbrales, fórmulas, casos borde). |
| `docs/do-not-touch.md` | Subsistemas que no se reescriben a la ligera — tocarlos exige un ADR. |
| `docs/adr/` | Architecture Decision Records — un archivo por decisión no trivial, numerado. |
| `docs/decisions/LOG.md` | Log append-only de decisiones/respuestas de stakeholders (`DEC-###`). |
| `docs/planning/` | Artefactos generados: backlog, roadmaps de sprint, cuerpos de tickets. Nombres de archivo con fecha, nada se edita a mano. |

## Precedencia cuando los docs no coinciden

1. Un `DEC-###` más nuevo en `LOG.md` gana sobre uno más viejo del mismo tema.
2. `docs/product/*` es la base congelada; las entradas de `LOG.md` son enmiendas sobre esa base.
3. **El estado real del repo gana sobre cualquier doc de planificación.** Si
   `docs/planning/*` dice que una tarea está hecha y el código dice lo
   contrario, se confía en el código y se marca el doc como desactualizado.

Esto refleja la jerarquía validada en Casper (`docs/cto` → MVP en vivo →
`prototype-changelog.md`), generalizada: spec base → log de decisiones →
realidad en vivo (repo/staging).
