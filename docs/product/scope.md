# Alcance — V1

## Entra

- Dominio: Auction, Lot, Bid, Bidder y las 5 reglas de negocio.
- Eventos de dominio (§3 de la spec) como fuente de verdad en Kafka.
- API REST de comandos + API GraphQL de lecturas (queries y subscriptions).
- Outbox, relay, `projector`, `notifier`, `auditor`, idempotencia, reintentos, DLQ.
- Reproceso desde el log.
- Seguridad mapeada a OWASP, CI en GitHub Actions, ADRs.
- Despliegue en Azure con Bicep y entorno local con docker-compose.

## Fuera de alcance (diferido a propósito)

- Pagos, facturación y logística posterior a la adjudicación.
- UI web para postores (solo APIs; se demuestra con cliente de prueba/scripts).
- Multi-región y alta disponibilidad real en Azure.
- Rebalanceo de lotes calientes entre particiones (se documenta como costo en el ADR).
- Row-Level Security por tenant: opcional.
