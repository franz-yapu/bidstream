# 0009 — El log es la fuente de verdad: reproceso desde `earliest`

**Estado:** Aceptada
**Fecha:** 2026-11-13 (decisión de la spec §5, implementada en G1 y G2)

## Contexto

La proyección es una vista derivada. Si un consumidor tenía un error o cambia el modelo, hay que
poder rehacerla. Una cola tradicional borra lo consumido; Kafka conserva el log.

## Decisión

El topic de eventos tiene retención ilimitada y es la fuente de verdad. Reconstruir la proyección =
borrar las tablas derivadas (y el registro `processed_event` del `projector`) y reposicionar el grupo
a `earliest` borrando el grupo vacío, porque el cliente no tiene `setOffsets`. Se hace con un
comando (`npm run reprocess`), nunca por una ruta HTTP. La bitácora `audit_log` no se toca.

## Alternativas descartadas

| Alternativa                      | Por qué no                                                              |
| -------------------------------- | ----------------------------------------------------------------------- |
| Instantáneas de la proyección    | Otra fuente de verdad que mantener y que puede divergir                 |
| Reparar filas a mano             | No reproducible ni verificable                                          |
| Ruta HTTP de reproceso completo  | Borra datos y es demasiado peligrosa para exponerla                     |

## Consecuencias

**Se gana:** reconstrucción determinista, demostrada con uno y con dos consumidores.

**Se pierde:** mientras reconstruye, las lecturas devuelven un estado parcial; el log crece sin límite.

**Obliga a:** que los consumidores sean deterministas y que el formato de los eventos esté versionado.

## Verificación

- SDD: [G1](../sdd/G1/SDD.md), [G2](../sdd/G2/SDD.md).
- Pruebas: [`reprocess.int.test.ts`](../../apps/projector/src/reprocess.int.test.ts);
  código: [`reprocess.ts`](../../apps/projector/src/reprocess.ts).
