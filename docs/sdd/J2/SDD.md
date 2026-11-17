# SDD — J2 · Sitio público, vista de espectador y rediseño

- **Ticket:** ClickUp **J2** (`868mwj8aq`, https://app.clickup.com/t/868mwj8aq).
- **Autor:** generado con Claude (Entregable 1).
- **Estado:** Implementado (2026-11-16) — aprobado con las propuestas de §7; ver la revisión 0.2 al pie
- **Versión:** 0.1 · **Fecha:** 2026-11-16
- **Fuentes de verdad citadas:**
  1. Petición del usuario (2026-11-16): home público, página de subastas en curso, entrar como
     espectador y ver quién gana y quién pujó, login fácil, «mejor diseño en todo el sistema».
  2. Decisiones del usuario (2026-11-16): nombre público de cada postor; estilo claro, editorial y
     premium; home con hero + en vivo + próximas + cómo funciona + finalizadas.
  3. `apps/graphql/src/{schema,tenant,resolvers}.ts` (hoy sin identidad de postor y con token obligatorio).
  4. `packages/db/prisma/schema.prisma` (`AppUser`, `Bid`, `Lot`), `apps/api/src/routes/auth.ts`.
  5. `docs/sdd/J1/SDD.md`, `docs/adr/0013-*.md`, `SECURITY.md` (A01, A02, A04).

---

## 1 · Alcance

### Entra
- **Sitio público sin cuenta** (`/`, `/subastas`, `/subastas/:id`, `/lotes/:id`): cualquiera ve lo que ocurre.
  - **Home**: hero con mensaje y llamada a la acción; lotes **en vivo ahora** (precio y cuenta atrás);
    **próximas** subastas; **cómo funciona** (3 pasos); **finalizadas** con precio final.
  - **Subastas**: listado filtrable (En curso · Próximas · Finalizadas).
  - **Lote como espectador**: precio actual, **quién va ganando**, **historial de pujas con el nombre
    público** de cada postor y la hora, cuánto falta, hora de cierre, precio de salida, incremento
    mínimo y precio final y ganador si ya cerró. Todo en vivo, igual que hoy.
  - Para pujar, la página pide entrar o registrarse y **vuelve al mismo lote** después.
- **Nombre público** (`displayName`): se pide al registrarse (2–30 caracteres), se muestra en las pujas
  y se puede cambiar en «Mi cuenta». El administrador inicial lleva uno por defecto.
- **Login/registro rediseñados**: una sola pantalla con pestañas Entrar/Crear cuenta, sin pedir el
  tenant (lo fija el despliegue), mensajes claros, mostrar/ocultar contraseña, foco y teclado cuidados.
- **Rediseño de todo el sistema** (claro, editorial, premium): tokens de diseño, tipografía con
  carácter, cabecera con navegación y menú de usuario, tarjetas de lote con imagen de relleno
  generada (sin fotos reales), estados vacíos, carga y error cuidados, panel de administración y
  formularios coherentes, móvil primero, `prefers-reduced-motion`.
- **Backend** (mínimo): acceso anónimo de solo lectura a GraphQL para el tenant público;
  `displayName` en `AppUser`; `Bid.bidder { displayName }` y `Lot.leader { displayName }` en GraphQL.

### No entra (a propósito)
- Fotos reales de producto ni subida de imágenes (no hay almacenamiento; se propone aparte).
- Pujar sin cuenta; notificaciones por correo; pagos; multi-tenant público (un solo tenant público).
- Verificación de que el nombre público no sea ofensivo (solo longitud y caracteres; moderación = admin
  puede renombrar, ver §7).
- Cookie `HttpOnly` para el refresco (sigue como deuda de J1).

### Premisas verificadas
- Hoy GraphQL exige token o `X-Tenant-Id` (solo desarrollo): un visitante anónimo **no puede leer**.
- `Bid.bidderId` = `AppUser.id`; GraphQL no expone ningún dato del postor.
- `Lot.winnerId`/`LotDecision.currentBidder` existen: ganador y líder se pueden resolver.

---

## 2 · Diseño técnico

### 2.1 Cambio de política de privacidad (nuevo ADR-0015)
Hasta J1 «GraphQL sin identidad de postores/ganadores». El usuario decide **mostrar el nombre público**.
- Solo se expone `displayName`, nunca `email`, `id` de usuario ni `bidderId`.
- El nombre es **elegido por el usuario**, avisado al registrarse («será visible en las subastas»).
- Un usuario no puede ver el correo de otro; el espectador anónimo tampoco.
- El ADR-0015 reemplaza la regla y se anota en `SECURITY.md` (A01/A04) y `CLAUDE.md`.
- **Riesgo asumido**: un nombre real identifica a la persona; el aviso y la edición lo mitigan (§6).

### 2.2 Acceso anónimo a GraphQL
- Variable `PUBLIC_TENANT_ID` (UUID, opcional). Si está definida y la petición **no trae**
  `Authorization`, GraphQL resuelve ese tenant en lugar de rechazar con `UNAUTHENTICATED`.
- Con token, sigue mandando el tenant del token. Un token inválido sigue siendo `UNAUTHENTICATED`
  (no se degrada a anónimo).
- Solo lectura: GraphQL ya no tiene mutaciones. Los límites de coste/profundidad y la limitación por IP
  de F2 se mantienen y el anónimo cuenta por IP con un cupo propio más bajo.
- Las suscripciones SSE anónimas igual (mismo `resolveTenant`); tope de conexiones por IP ya existente.
- En producción `X-Tenant-Id` sigue prohibido; el tenant público lo fija el entorno, no el cliente.

### 2.3 Datos
- Migración `0008_app_user_display_name`: `display_name TEXT NOT NULL` con relleno de las filas
  existentes (`'Postor ' || left(replace(id::text,'-',''),4)`; administrador: `'Administrador'`),
  restricción de longitud 2–30.
- `POST /auth/register` acepta `displayName` obligatorio; `PATCH /auth/me` permite cambiarlo.
- GraphQL: `Bid.bidder: Bidder!` (`displayName`) y `Lot.leader: Bidder` (nulo sin pujas); `Lot.winner:
  Bidder` si cerró. Se resuelven en lote con un `DataLoader` por petición (sin N+1).

### 2.4 Rutas del front
| Ruta | Acceso | Contenido |
|---|---|---|
| `/` | público | Home |
| `/subastas` | público | Listado con filtros |
| `/subastas/:id` | público | Subasta y sus lotes |
| `/lotes` | público | Todos los lotes (abiertos o cerrados) con orden por cierre o precio |
| `/lotes/:id` | público | Espectador; si hay sesión de postor, añade el formulario de puja |
| `/entrar` | público | Entrar / Crear cuenta (con `?volver=`) |
| `/cuenta` | sesión | Nombre público, cerrar sesión |
| `/admin/*` | ADMIN/SELLER | Crear subasta, DLQ (ya existen, rediseñados) |

`/login` y `/registro` redirigen a `/entrar`. Las rutas con `RequireRole` no cambian de contrato.

### 2.5 Diseño
- **Método** (petición del usuario, 2026-11-16): el diseño se hace con las skills `design-taste-frontend`
  (dirección de arte y bucle de captura-corrección), `impeccable` (jerarquía, tipografía, color,
  accesibilidad) y `emil-design-eng` (movimiento y detalle de interacción). Cada pantalla se revisa con
  capturas de escritorio y móvil antes de darla por buena.
- **Dirección**: casa de subastas moderna, clara y cálida. Fondo marfil, tinta casi negra, un acento
  (verde bosque o burdeos, a decidir en §7), serif con carácter para titulares y sans legible para datos;
  cifras tabulares para precios.
- **Sistema**: tokens en `styles.css` (`@theme` de Tailwind 4), escala de espaciado y radios,
  componentes `Card`, `Button`, `Field`, `Badge`, `EmptyState`, `Skeleton`.
- **Lote**: columna principal con precio grande, cuenta atrás y estado; panel lateral con puja
  (sesión) o «Entra para pujar» (anónimo); historial con avatar de iniciales y marca de líder.
- **Movimiento**: aparición escalonada discreta, precio con cambio animado al subir, cuenta atrás con
  tono de urgencia; todo desactivado con `prefers-reduced-motion`.
- **Accesibilidad**: contraste AA, foco visible, `aria-live` en precio, `role="timer"`, saltar al
  contenido, tabs con roles ARIA. Se mantienen los `data-testid` `price` y `countdown` y las etiquetas
  que usa el e2e.

### 2.6 Tiempo real
Igual que J1 (SSE + refresco cada 4 s del historial). El líder y el historial se actualizan con el
mismo flujo; no se añaden canales.

---

## 3 · Cambios por archivo/módulo
- `packages/db`: migración `0008`, `schema.prisma`, listas de tablas/columnas en pruebas de BD.
- `apps/api`: `auth` (registro con `displayName`, `PATCH /auth/me`), bootstrap del administrador.
- `apps/graphql`: `tenant.ts` (anónimo), `schema.ts`/`resolvers.ts` (`Bidder`, `leader`, `winner`),
  `DataLoader`, configuración `PUBLIC_TENANT_ID`, límites anónimos.
- `apps/web`: tokens y componentes base; páginas `Home`, `Auctions`, `AuctionDetail`, `LotPage`,
  `Login` (unificado), `Account`, admin; `routes.tsx`; consultas sin sesión; `config.js` con
  `PUBLIC_TENANT_ID`.
- `docker-compose.yml`, Bicep: `PUBLIC_TENANT_ID` en GraphQL y `DEFAULT_TENANT_ID` en web.
- Docs: ADR-0015, `SECURITY.md`, README, `docs/DESARROLLO.md`, `CLAUDE.md`, roadmap, LOG.

## 4 · Plan de tests
- **Integración GraphQL**: anónimo lee con `PUBLIC_TENANT_ID`; sin la variable sigue rechazando; token
  inválido no degrada; `Bid.bidder` solo expone `displayName`; ningún campo devuelve `email`/ids de
  usuario; el anónimo respeta el límite de coste.
- **Integración API**: registro exige y valida `displayName`; `PATCH /auth/me`; migración rellena filas.
- **Unitarias web**: rutas públicas sin sesión, redirección `?volver=`, tarjetas, formato, pestañas del
  login, estados vacíos y de error.
- **Política** (`web-policy.test.ts`): sin `localStorage`, sin HTML crudo, sin secretos `VITE_*`.
- **e2e Playwright**: espectador anónimo ve home, entra al lote y ve líder e historial; postor pide
  entrar desde el lote, vuelve y puja; el espectador lo ve sin recargar. Los casos actuales se adaptan.
- **Revisión visual**: capturas de escritorio y móvil de cada pantalla antes de cerrar.

## 5 · Definition of Done
- Home, listado y lote públicos funcionando sin cuenta; líder e historial con nombre público en vivo.
- Login/registro unificados con `?volver=`; nombre público editable.
- Todo el front con el nuevo sistema de diseño; AA y móvil verificados con capturas.
- ADR-0015 y docs actualizadas; `npm run check` y `npm run test:integration` verdes; e2e verde en CI.
- Sin `email`, `id` de usuario ni `bidderId` en ninguna respuesta pública (prueba que lo vigila).

## 6 · Riesgos
| Riesgo | Mitigación |
|---|---|
| Nombres reales expuestos | Aviso al registrarse, campo editable, alias por defecto, admin puede renombrar |
| Abuso del acceso anónimo (scraping/DoS) | Cupo por IP más bajo, límites de coste/profundidad, tope de conexiones SSE |
| Nombres ofensivos o suplantación | Longitud/caracteres, único por tenant sin distinguir mayúsculas, renombrado por admin |
| Rediseño grande rompe e2e/accesibilidad | Mantener `data-testid`/roles, capturas y pruebas por pantalla, PRs por tramos |
| Migración sobre filas existentes | Relleno determinista y prueba de migración |

## 7 · Preguntas abiertas (con propuesta)
1. **Color de acento**: propuesta verde bosque con marfil y tinta (alternativa: burdeos).
2. **Nombre único**: propuesta única por tenant sin distinguir mayúsculas, para evitar suplantaciones.
3. **Renombrado por el admin** de nombres inadecuados: propuesta sí (`PATCH /admin/users/:id`), sin UI
   de moderación más allá de un campo en el panel.
4. **Imágenes**: propuesta de portadas generadas por la app (degradado + iniciales del lote), sin subir
   fotos; las fotos reales quedarían como ticket futuro (requiere almacenamiento).
5. **Entrega en PRs**: propuesta 3 PRs — (a) backend: `displayName`, anónimo, `Bidder`; (b) sistema de
   diseño + login + home/listados; (c) lote espectador/puja + admin + e2e. Cada uno con CI verde.
6. **Fuentes**: propuesta servirlas desde el propio sitio (sin CDN) para respetar la CSP.

## Revisión 0.2 (2026-11-16) — desviaciones del diseño aprobado, ya implementadas

- **Entrega:** el backend fue el PR #55; el sistema de diseño, el sitio público, el lote como espectador, el
  login unificado y la administración se entregaron juntos en un solo PR de front (no en dos), para no
  dejar `main` con medio rediseño.
- **Dirección de arte** (skills `design-taste-frontend`, `impeccable`, `emil-design-eng`): «la página es el
  objeto». El lote es un **billete de catálogo** (perforación punteada y muescas) y el pie de cada billete
  dice quién va ganando. Marfil, tinta y verde bosque; Fraunces para titulares y Hanken Grotesk para el
  texto, ambas autoalojadas. Sin degradados, sin sombras en reposo y sin iconos Unicode: iconos en SVG.
- **Home:** hero con el lote que cierra antes, en vivo ahora, próximas, cómo funciona y finalizadas con el
  ganador y el precio final. Para no superar el límite de coste de GraphQL, el inicio pide pocas subastas
  (6) y pocos lotes (6) por consulta.
- **Líder del lote:** sale de la puja mejor clasificada (la misma lista que se ve), no de una consulta aparte.
- **Datos de ejemplo:** `make demo-seed` (`scripts/demo-seed.mjs`) usa solo la API pública.
- El renombrado por administrador (§7.3) queda como ticket aparte: no hay UI de moderación todavía.

## Revisión 0.3 (2026-11-16) — pulido pedido por el usuario («hazlo 1 a 5»)

- **Portadas de lote** generadas a partir del id (formas planas con la paleta; `LotCover`), en el billete y en la página del lote. Es la propuesta de §7.4; las fotos reales siguen pendientes.
- **Puja rápida:** atajos con el mínimo y saltos de incremento (en céntimos con `BigInt`); rellenan el campo, no envían nada.
- **Estado del postor** («Vas ganando», «Te han superado», con el mínimo para volver a ganar), marca «Tú» en el historial y animación de las pujas nuevas. Se reconoce al postor por su nombre público, único por tenant.
- **Inicio en vivo:** el inicio y la columna de «Entrar» consultan cada 8 s y resaltan los cambios de precio y de líder.
- **Menú móvil** con botón y panel accesibles (`aria-expanded`, `aria-controls`).

## Revisión 0.4 (2026-11-16) — navegación («sigue con el 6 al 9»)

- **`/lotes`, «Todos los lotes»:** abiertos/cerrados y orden (cierran antes, precio ↑/↓) sobre las 12 subastas más recientes con 12 lotes cada una (dentro del límite de coste de GraphQL). El mismo selector ordena los lotes dentro de una subasta (`lib/lots.ts`).
- **Subastas con datos:** cada tarjeta muestra lotes, precio más alto y cuenta atrás hasta el próximo cierre (`Auction.lots`, 10 por subasta).
- **404 real:** `*` ya no redirige al inicio; ofrece inicio, subastas y lotes.
- **Títulos y enlaces:** `usePageTitle` pone «Página · bidstream» en cada vista; «Copiar enlace» en subasta y lote; `description` y Open Graph genéricos en `index.html`. Una vista previa distinta por lote exigiría renderizar en servidor: queda fuera.

## Revisión 0.5 (2026-11-16) — estado a la vista y pujas sin entrar («puntos 10 a 13»)

Reclamo del usuario: no se distingue bien lo que está en proceso de lo que terminó y ver las pujas obliga a entrar en cada tarjeta.

- **Estado:** insignias «En proceso» (verde, con punto vivo) y «Terminado/a» (gris). Lotes y subastas se agrupan en bloques con título y cuenta (En proceso, Próximas, Terminadas); lo terminado va en tono arena y con la portada apagada, lo vivo con filete verde.
- **Pujas sin entrar:** cada billete tiene «Ver pujas» (las 5 mejores, carga bajo demanda y se refresca mientras el lote está abierto) y las páginas de lotes y de subasta un interruptor «Mostrar pujas» que las abre todas. El título es el enlace del billete (enlace extendido), así que el botón no queda dentro de otro enlace.
- **10, administración:** la cola de errores con tarjetas de pendientes y total, motivo con insignia y aviso del resultado.
- **11, carga:** las páginas de cuenta, nueva subasta y administración se descargan al visitarlas; librerías en trozos aparte. El mayor trozo pasa de 533 kB a 314 kB (sin aviso de tamaño).
- **12, accesibilidad:** `e2e/a11y.spec.ts` ejecuta axe (WCAG 2.2 AA, con contraste, movimiento reducido) sobre inicio, subastas, lotes, entrar, registro, 404 y un lote con pujas abiertas.
- **13, renombrado por el administrador:** `GET /v1/auth/users` y `PATCH /v1/auth/users/{userId}` (solo `ADMIN`, solo usuarios de su tenant; mismas reglas de formato y unicidad; 404 si el usuario es de otro tenant) y la pantalla `/admin/usuarios` con búsqueda y cambio de nombre en línea. El menú pasa de «DLQ» a «Administración», con las secciones Usuarios y Cola de errores.

## Revisión 0.6 (2026-11-17) — identidad visual («toma todo, quiero ver el diseño»)

Reclamo: la web se ve genérica frente a TECAB y al portfolio de referencia. Se toma de ambas: de la primera, rótulos con filete, recorrido numerado con cifras en contorno y banda de cierre oscura; de la segunda, titular enorme con palabra de acento, resplandores y alternancia de secciones claras y oscuras.

- **Inicio:** sello propio (anillo de texto que gira, «b» y punto en vivo), titular con acento, tarjeta «Cierra primero», cifras de situación, banda oscura «En proceso ahora», recorrido de 4 pasos, «Para quién es» con pestañas, resultados y banda de cierre. Las secciones entran con `Reveal` (IntersectionObserver; sin él o con movimiento reducido se ven de inicio).
- **Portadas:** fotografías reales de dominio público (colección de acceso abierto del Metropolitan Museum of Art, CC0) en `apps/web/public/lots` con créditos en `CREDITS.md`; se eligen por palabras del título (reloj, mapa, jarrón, tetera, cuadro, escritorio) y, sin coincidencia, formas abstractas. Sigue pendiente subir fotos propias de cada lote (requiere almacenamiento).
- Los tokens añaden `night`, `lime` y `lime-deep`; los degradados y sombras quedan para el sello, los resplandores y la tarjeta flotante.

