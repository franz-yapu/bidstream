# Reglas de negocio

Fuente: `bidstream_spec.md` §2.

1. **Puja válida:** supera el precio actual del lote + incremento mínimo (`minIncrement`); si no hay pujas, parte de `startingPrice`.
2. **Desempate:** a igual monto gana la primera en el tiempo (índice `lotId, amount DESC, placedAt, id`).
3. **Anti-sniping:** una puja dentro de la ventana anti-sniping extiende el cierre N minutos (`LotExtended`).
4. **Cierre:** al cerrar se adjudica al mejor postor y se emite `LotClosed`.
5. **Adjudicación única:** un lote nunca se adjudica dos veces (índice único parcial).
6. **Dinero:** siempre `Decimal(12,2)`, nunca flotantes.
7. **Orden:** todas las pujas de un lote se procesan en orden estricto (clave de partición `lotId`).
8. **Eventos:** llevan `eventId` (UUID v7), `type`, `occurredAt`, `tenantId`, `version`, payload.
