# 0005 — Proyección sin clave foránea entre agregados

**Estado:** Aceptada
**Fecha:** 2026-11-13 (decisión tomada en D4)

## Contexto

`AuctionOpened` y `LotPublished` viven en particiones distintas (la clave es `lotId`, ver
[ADR-0001](0001-clave-de-particion-lotid.md)); Kafka no garantiza orden entre particiones. Al
reconstruir la proyección, un lote puede procesarse **antes** que su subasta. Con una clave foránea
`lot.auction_id → auction.id` esa carrera haría fallar el reproceso.

## Decisión

`lot.auction_id` no tiene clave foránea. La integridad entre agregados la valida la API al aceptar
el comando (C2 comprueba que la subasta existe y está abierta) y la consulta GraphQL tolera la
subasta ausente (`Lot.auction` es nulo-able).

## Alternativas descartadas

| Alternativa                                  | Por qué no                                                              |
| -------------------------------------------- | ----------------------------------------------------------------------- |
| Mantener la FK y reintentar hasta que exista | Bucles de reintento y DLQ por un orden que Kafka no promete             |
| Una única clave para subasta y lotes         | Un hot spot por subasta y se rompe [ADR-0001](0001-clave-de-particion-lotid.md) |

## Consecuencias

**Se gana:** reproceso determinista e idéntico con uno o varios consumidores.

**Se pierde:** la base no impide lotes huérfanos; la lectura debe tolerar la ausencia (consistencia eventual).

**Obliga a:** validar la referencia al aceptar el comando, no en la proyección.

## Verificación

- SDD: [D4](../sdd/D4/SDD.md) §2.4 y [C2](../sdd/C2/SDD.md).
- Pruebas: [`reprocess.int.test.ts`](../../apps/projector/src/reprocess.int.test.ts) (estado idéntico con dos consumidores),
  [`flow.int.test.ts`](../../apps/projector/src/flow.int.test.ts).
