# 0012 — Firma Ed25519 de los mensajes y verificación en el consumidor

**Estado:** Aceptada
**Fecha:** 2026-11-13 (decisión Q5 del usuario, implementada en F3)

## Contexto

El log de Kafka es la fuente de verdad ([ADR-0009](0009-el-log-es-la-fuente-de-verdad.md)): quien pueda
escribir en un topic puede inyectar o alterar eventos y comandos, y los consumidores los aplicarían sin
saberlo (OWASP A08). Hace falta que un consumidor compruebe que el mensaje lo publicó el relay y no ha
cambiado.

## Decisión

El relay **firma con Ed25519 los bytes exactos del valor** que publica y añade las cabeceras `x-signature`
(base64url) y `x-key-id`. Los consumidores (`projector`, `notifier`, `auditor` y los dos del decisor)
verifican con las claves **públicas**; una firma ausente, inválida o de un `kid` desconocido envía el
mensaje al DLQ como veneno, sin reintentos y sin aplicarlo. La clave privada la tiene solo el relay. Las
claves se identifican por `kid` y se pueden rotar. El DLQ conserva la firma y la clave del mensaje
original para que el reproceso (D7) republique el evento con sus cabeceras. Modo `enforce` por defecto en
producción y `off` fuera; `EVENT_SIGNING_REQUIRED_FROM` acepta sin firma lo anterior a un instante, para
que reconstruir desde `earliest` no rechace el historial previo a la firma.

## Alternativas descartadas

| Alternativa                          | Por qué no                                                                                    |
| ------------------------------------ | --------------------------------------------------------------------------------------------- |
| HMAC-SHA256 con secreto compartido   | Cualquier consumidor con el secreto también podría firmar eventos falsos                      |
| Firmar el objeto y no el texto       | Exigiría recanonicalizar: un cambio de serialización invalidaría firmas                       |
| Firma dentro del evento (`meta`)     | Cambia el contrato del evento y obliga a quitarla antes de firmar; las cabeceras no lo tocan  |
| TLS/ACL de Kafka como única defensa  | Protege el transporte y el acceso, no la autenticidad de lo que ya está en el log             |

## Consecuencias

**Se gana:** un consumidor detecta mensajes manipulados o inyectados; ningún consumidor puede falsificar
eventos; rotación sin ventana de corte; el reproceso desde el log sigue funcionando.

**Se pierde:** una clave más que custodiar (Key Vault en H1); un coste de CPU pequeño por mensaje; y un
límite conocido: la fecha de un mensaje **sin firma** la declara el propio mensaje, así que el corte
`EVENT_SIGNING_REQUIRED_FROM` solo protege hasta que el historial esté sellado. Cuando lo esté, se
quita y todo mensaje debe ir firmado.

**Obliga a:** retirar el `kid` de `EVENT_VERIFICATION_KEYS` si una clave privada se compromete (lo
firmado con ella deja de aceptarse y habrá que volver a emitir lo legítimo); a no loguear nunca la clave
privada; y a que cualquier productor nuevo publique por el relay.

## Verificación

- SDD: [F3](../sdd/F3/SDD.md).
- Pruebas: [`signing.test.ts`](../../packages/signing/src/signing.test.ts) (firma, manipulación, otra
  clave, asimetría, rotación, corte del historial) y
  [`signing.int.test.ts`](../../apps/projector/src/signing.int.test.ts) (el relay firma, un mensaje
  manipulado va al DLQ sin aplicarse, rotación, reproceso con historial mezclado, D7 conserva la firma y
  la clave privada no aparece en logs).
