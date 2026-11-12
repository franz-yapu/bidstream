# Reglas de negocio

Fuente: `bidstream_spec.md` §2.

1. **Puja válida:** supera el precio actual del lote + incremento mínimo (`minIncrement`); la primera puja debe ser `>= startingPrice`; las siguientes, `>= precio actual + minIncrement` (DEC-009).
2. **Desempate:** a igual monto gana la primera en el tiempo (índice `lotId, amount DESC, placedAt, id`).
3. **Anti-sniping:** una puja dentro de la ventana anti-sniping extiende el cierre N minutos **contados desde `closesAt`**; la ventana incluye el borde (`closesAt - placedAt <= ventana`) (DEC-009, `LotExtended`).
4. **Cierre:** al cerrar se adjudica al mejor postor y se emite `LotClosed`.
5. **Adjudicación única:** un lote nunca se adjudica dos veces (restricción en la base: `bid_one_awarded_per_lot_idx`, como mucho una puja `awarded` por lote; B1).
6. **Dinero:** siempre `Decimal(12,2)`, nunca flotantes.
7. **Orden:** todas las pujas de un lote se procesan en orden estricto (clave de partición `lotId`).
8. **Eventos:** llevan `eventId` (UUID v7), `type`, `occurredAt`, `tenantId`, `version`, payload.
9. **Cierre de subasta:** `AuctionClosed` solo si no quedan lotes abiertos (DEC-009).
10. **Autopuja:** un postor puede subir su propia puja vigente (DEC-009).
