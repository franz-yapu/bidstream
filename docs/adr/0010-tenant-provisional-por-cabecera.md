# 0010 — Tenant provisional por cabecera, prohibido en producción

**Estado:** Aceptada (provisional hasta F1)
**Fecha:** 2026-11-13 (decisión tomada en C2 y E1)

## Contexto

Todo dato pertenece a un tenant. La autenticación (F1) depende de la decisión Q4, que sigue abierta,
pero el resto del sistema necesita un tenant para funcionar y probarse.

## Decisión

Mientras no exista F1, el tenant se resuelve por la cabecera `X-Tenant-Id`, **solo fuera de
producción**. Con `NODE_ENV=production` ni la API ni GraphQL arrancan hasta que exista otro
resolvedor de tenant.

## Alternativas descartadas

| Alternativa                      | Por qué no                                                                |
| -------------------------------- | ------------------------------------------------------------------------- |
| Aceptar la cabecera siempre      | Cualquiera podría leer o escribir en el tenant que quisiera               |
| Tenant fijo                      | Oculta los fallos de aislamiento que las pruebas deben encontrar          |

## Consecuencias

**Se gana:** el modo inseguro no puede llegar a producción por descuido.

**Se pierde:** no se puede desplegar hasta F1.

**Obliga a:** reemplazar este ADR cuando se decida Q4 e implemente F1.

## Verificación

- SDD: [C2](../sdd/C2/SDD.md), [E1](../sdd/E1/SDD.md).
- Pruebas: [`config.test.ts`](../../apps/api/src/config.test.ts) y [`config.test.ts`](../../apps/graphql/src/config.test.ts);
  código: [`tenant.ts`](../../apps/api/src/tenant.ts).
