# 0014 — Front como SPA de React + Vite, con la sesión en memoria y el refresco en `sessionStorage`

**Estado:** Aceptada
**Fecha:** 2026-11-16 (decisión del usuario: «React + Vite»; sesión por las propuestas aprobadas del SDD de J1)

## Contexto

bidstream solo tenía API y GraphQL. Hacía falta una interfaz para postores (ver subastas, pujar con el
precio en vivo) y para administradores (publicar, vigilar el DLQ). Toda la aplicación exige sesión
([ADR-0013](0013-autenticacion-propia-y-rbac.md)), el tiempo real ya llega por SSE
([ADR-0008](0008-tiempo-real-listen-notify-sse.md)) y la puja es asíncrona
([ADR-0003](0003-la-puja-devuelve-202.md)).

## Decisión

- **SPA** en `apps/web` con React 19, TypeScript estricto y Vite; sin SSR. Datos con TanStack Query,
  formularios con React Hook Form + Zod, estilos con Tailwind. GraphQL con `fetch` simple y la
  subscription `lotUpdated` con `graphql-sse`: el esquema es solo de lectura y no hace falta un cliente
  normalizado.
- **Sesión:** el token de acceso (10 min) vive **solo en memoria**; el de refresco (opaco, de un solo uso,
  con rotación) en `sessionStorage`. Nunca `localStorage`. Varios 401 simultáneos hacen **un único**
  refresco compartido, porque un segundo uso invalidaría la sesión en el servidor.
- **La puja se confirma por el canal en vivo**, no por el `202`: la `Idempotency-Key` se mantiene en los
  reintentos del mismo importe y se renueva tras cada puja. El motivo de un rechazo no se muestra: no se
  publica por GraphQL para no filtrar información de otros postores.
- **Imagen:** nginx sin privilegios, base fijada por digest, con CSP restringida a la API y GraphQL
  configuradas **al arrancar** (la misma imagen sirve en cualquier entorno). El reloj de la cuenta atrás se
  corrige con la cabecera `Date` de las respuestas, expuesta por CORS.
- La interfaz solo oculta lo que el backend ya deniega: la autorización real sigue en la API y en GraphQL.

## Alternativas descartadas

| Alternativa                                   | Por qué no                                                                                    |
| --------------------------------------------- | --------------------------------------------------------------------------------------------- |
| Next.js con SSR                               | Todo está tras login (sin SEO) y ya hay backend propio: sería un segundo servidor sin beneficio |
| Refresco en cookie `HttpOnly`                 | Exige cambios de backend (cookie `SameSite`, CSRF); queda como mejora con su propio ADR       |
| Tokens en `localStorage`                      | Cualquier XSS los lee y el refresco duraría días en el disco                                  |
| Cliente GraphQL normalizado (Apollo, urql)    | Más peso y magia para un esquema de solo lectura con cuatro consultas                         |
| Angular, Vue, Svelte                          | Válidos; React tiene el mayor ecosistema y encaja con el resto del TypeScript del proyecto    |

## Consecuencias

**Se gana:** una interfaz completa sin tocar los contratos REST; la misma imagen en todos los entornos;
cabeceras de seguridad y CSP estrictas.

**Se pierde:** al cerrar la pestaña se pierde la sesión (por diseño); el rechazo de una puja se informa
sin motivo; si la subscription se corta, el precio puede tardar hasta 15 s en refrescarse por consulta.

**Obliga a:** declarar el origen del front en `CORS_ALLOWED_ORIGINS` de la API y de GraphQL; mantener la
política de código (`packages/testing/src/policy/web-policy.test.ts`: sin `localStorage`, sin HTML crudo,
sin secretos en `VITE_*`, dinero sin coma flotante).

## Verificación

- SDD de origen: [`docs/sdd/J1/SDD.md`](../sdd/J1/SDD.md).
- Sesión y refresco único: [`apps/web/src/api/session.test.ts`](../../apps/web/src/api/session.test.ts).
- Puja e `Idempotency-Key`: [`apps/web/src/components/BidForm.test.tsx`](../../apps/web/src/components/BidForm.test.tsx).
- Flujo completo con navegador (login, subasta, puja, precio en vivo en otra pestaña):
  [`apps/web/e2e/flow.spec.ts`](../../apps/web/e2e/flow.spec.ts).
- Política del front y de la imagen: [`packages/testing/src/policy/web-policy.test.ts`](../../packages/testing/src/policy/web-policy.test.ts).
