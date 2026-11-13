# Registro de decisiones de arquitectura (ADR)

Cada decisión de diseño que condiciona el sistema tiene su ADR: contexto, decisión, alternativas
descartadas, consecuencias y la evidencia (SDD y pruebas) que la respalda. Para escribir uno, copia
[`0000-template.md`](0000-template.md) con el siguiente número. Un ADR no se edita para cambiar de
opinión: se escribe otro que lo **reemplace** (ver [`do-not-touch.md`](../do-not-touch.md)).

| N.º | Decisión | Estado | Fecha | Origen |
| --- | -------- | ------ | ----- | ------ |
| [0001](0001-clave-de-particion-lotid.md) | Clave de partición `lotId` | Aceptada | 2026-11-12 | Spec §4 |
| [0002](0002-patron-outbox.md) | Patrón outbox: nunca escritura dual | Aceptada | 2026-11-13 | Spec §5; B2, D1 |
| [0003](0003-la-puja-devuelve-202.md) | La puja devuelve `202 Accepted` | Aceptada | 2026-11-13 | Spec §7 |
| [0004](0004-graphql-solo-lecturas.md) | GraphQL solo para lecturas, REST para comandos | Aceptada | 2026-11-13 | Spec §7; E1–E3 |
| [0005](0005-proyeccion-sin-fk-entre-agregados.md) | Proyección sin clave foránea entre agregados | Aceptada | 2026-11-13 | D4 |
| [0006](0006-un-unico-relay-activo.md) | Un único relay activo con bloqueo asesor | Aceptada | 2026-11-13 | D1 |
| [0007](0007-consumidores-idempotentes-y-dlq.md) | Consumidores idempotentes, reintentos y DLQ | Aceptada | 2026-11-13 | D2, D3, D7 |
| [0008](0008-tiempo-real-listen-notify-sse.md) | Tiempo real con `LISTEN/NOTIFY` y SSE | Aceptada | 2026-11-13 | D5, E3 |
| [0009](0009-el-log-es-la-fuente-de-verdad.md) | El log es la fuente de verdad: reproceso desde `earliest` | Aceptada | 2026-11-13 | Spec §5; G1, G2 |
| [0010](0010-tenant-provisional-por-cabecera.md) | Tenant provisional por cabecera, prohibido en producción | Reemplazada por 0013 | 2026-11-13 | C2, E1 |
| [0011](0011-decisor-unico-por-lote.md) | Decisor único por lote con estado propio | Aceptada | 2026-11-13 | Q2; C3 |
| [0012](0012-firma-ed25519-de-eventos.md) | Firma Ed25519 de los mensajes y verificación en el consumidor | Aceptada | 2026-11-13 | Q5; F3 |
| [0013](0013-autenticacion-propia-y-rbac.md) | Autenticación propia, JWT corto con refresh rotatorio y RBAC denegando por defecto | Aceptada | 2026-11-13 | Q4; F1 |
