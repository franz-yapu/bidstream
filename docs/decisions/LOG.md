# Log de decisiones

Append-only. Una entrada por respuesta de stakeholder, resolución de
discrepancia, o decisión de alcance que no queda cubierta por un ADR. Nunca se
edita una entrada pasada — se reemplaza con una nueva que referencia el ID
viejo.

Formato:

```
## DEC-001 — <título corto>
**Fecha:** YYYY-MM-DD · **Fuente:** <quién/dónde> · **Estado:** activa | reemplazada por DEC-XXX

<qué se decidió, en lenguaje llano>
```

## DEC-001 — Metodología: SDD con skills y MCP en Claude Code
**Fecha:** 2026-11-12 · **Fuente:** usuario · **Estado:** activa

El proyecto vive en `~/Documentos/bidstream`. Se trabaja con IA (Claude Code)
usando skills del kit de planificación (prd-to-tickets, write-sdd, task-brief…)
y MCPs, y con SDD (Spec-Driven Development): cada ticket tiene su SDD en
`docs/sdd/<ID>/SDD.md` antes de codear. La spec base es `docs/product/bidstream_spec.md`.

## DEC-002 — Tracker ClickUp y carpeta de Drive
**Fecha:** 2026-11-12 · **Fuente:** usuario · **Estado:** activa

Tickets en ClickUp, lista bidstream `901115726262` en FRANZ's Space (igual que SISET). MCP de Google Drive conectado; carpeta de documentos en Drive: `bidstream` (id 1hZw2PqnTcYj8eV-8ju7VfH12MQZ61GgA).
