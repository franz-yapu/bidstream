# SDD — E2 · Límites de profundidad y complejidad de consulta

- **Ticket:** ClickUp **E2** (`868mvty12`, https://app.clickup.com/t/868mvty12).
- **Autor:** generado con Claude (Entregable 1).
- **Estado:** Aprobado (2026-11-12)
- **Versión:** 1.0 · **Fecha:** 2026-11-12
- **Fuentes de verdad citadas:**
  1. `docs/product/bidstream_spec.md` §7 ("Límites obligatorios: profundidad máxima de consulta, cálculo de complejidad y paginación por cursor. Una API GraphQL sin esos tres límites es una denegación de servicio esperando a ocurrir, y conviene decirlo en el README"), §8 A03 (límites de profundidad en GraphQL), A04 (diseño inseguro), A05 (mala configuración)
  2. `docs/sdd/E1/SDD.md` (esquema, tope de `first`, errores con códigos estables)
  3. `docs/sdd/C1/SDD.md` (errores sin detalles internos)

---

## 0 · Preguntas que el ticket pidió cerrar

| # | Pregunta del ticket | Respuesta |
|---|---|---|
| 1 | ¿Qué límites y con qué valores? | Profundidad 7, complejidad 1 000, 15 alias, 2 000 *tokens*, `first` máximo 100 y cuerpo de 100 KB; todos configurables (§2.2) |

---

## 1 · Alcance

### Entra

- **Profundidad máxima** de la consulta.
- **Cálculo de complejidad** por consulta, **consciente de la paginación** (el coste de una lista es `first × coste de sus hijos`).
- Límite de **alias** y de **tamaño** del documento (*tokens*) y del cuerpo HTTP.
- Tope de `first` (reutiliza el de E1) y **lotes de consultas** (*batching*) desactivados.
- Errores claros con código estable y **sin** detalles internos en producción.
- Introspección y GraphiQL controlados por entorno.
- Aplican por igual a consultas y a subscriptions (son documentos GraphQL).
- Pruebas que demuestran el rechazo de cada abuso y la aceptación de lo legítimo.

### No entra (a propósito)

- Limitación de tasa por cliente (A04 «límite de pujas por postor y minuto» es de F2).
- Consultas persistidas (lista blanca de documentos): posible evolución.
- Límites de la `Subscription` (conexiones por tenant, cola por suscriptor) → E3.
- Autenticación y cuotas por usuario → F1/F2.

### Premisas verificadas (heredadas de `task-brief`)

| Premisa del ticket | Qué hay de verdad |
|---|---|
| "Límite de profundidad y complejidad" | E1 solo pone topes a `first`; una consulta `activeLots { auction { lots { auction { lots … } } } }` sigue siendo ilimitada en profundidad |
| Librerías | `graphql-query-complexity` 2.0.0 (julio 2026) calcula complejidad con estimadores personalizables, por lo que permite multiplicar por `first`. `@escape.tech/graphql-armor` 3.2.0 trae profundidad, alias y *tokens*, pero **no se actualiza desde diciembre de 2025** y su coste no multiplica por el tamaño de página. `graphql-depth-limit` está abandonada (2022) |
| Yoga | Permite añadir reglas de validación (`useEnvelop`/`validationRules`), limitar el tamaño del cuerpo y desactivar el *batching* y la introspección |
| `graphql-js` | La opción `maxTokens` de `parse` depende de la versión; se verifica en el *spike* |

---

## 2 · Diseño técnico

### 2.1 Decisiones y por qué

| Decisión | Elección | Por qué |
|---|---|---|
| Profundidad | **Regla de validación propia** (~40 líneas, contando fragmentos en línea y con nombre, con detección de ciclos) | Es lo más pequeño y auditable; evita depender de una librería abandonada o de un paquete que no se actualiza |
| Alias | Regla propia que cuenta los alias de todo el documento | Frena el *alias overloading* (pedir la misma consulta cara muchas veces) |
| Complejidad | **`graphql-query-complexity`** con un estimador que multiplica por `first` | Mantenida, estándar de facto y soporta estimadores propios; el coste de una lista es `first × hijos` |
| Tamaño | Límite de bytes del cuerpo HTTP y `maxTokens` del analizador | Corta documentos gigantes antes de analizarlos |
| *Batching* | Desactivado | Un lote de consultas multiplica el coste y esquiva el cálculo por petición |
| Validación previa | Las reglas se ejecutan **antes** de ejecutar ningún resolver | Un documento rechazado no toca la base de datos |
| Introspección | Activa en desarrollo y pruebas; **desactivada en producción** y publicado el SDL en el repositorio | Reduce la superficie (A05) sin ocultar el esquema, que es público en el repositorio |
| Errores | Código estable `QUERY_TOO_DEEP`, `QUERY_TOO_COMPLEX`, `TOO_MANY_ALIASES`, `QUERY_TOO_LARGE`; mensaje que dice el límite y el valor | El cliente legítimo sabe qué ajustar; no se filtra nada interno |

### 2.2 Valores por defecto (configurables por entorno)

| Límite | Variable | Valor |
|---|---|---:|
| Profundidad máxima | `GQL_MAX_DEPTH` | 7 |
| Complejidad máxima | `GQL_MAX_COMPLEXITY` | 1 000 |
| Alias máximos | `GQL_MAX_ALIASES` | 15 |
| *Tokens* máximos | `GQL_MAX_TOKENS` | 2 000 |
| Cuerpo máximo | `GQL_MAX_BODY_BYTES` | 102 400 |
| `first` máximo | `GQL_MAX_PAGE_SIZE` | 100 |

Los valores se justifican con las consultas legítimas del propio esquema: `lot { auction { lots { bids } } }` tiene profundidad 5 y coste ≈ 1 + 1 + 50·(1 + 20·1) = 1 052; por eso el tope de complejidad se fija con una consulta real de referencia (§4) y se ajusta si hace falta.

### 2.3 Modelo de coste

Cada campo cuesta 1; un campo de lista con argumento `first` cuesta `first × (1 + coste de sus hijos)`; los escalares cuestan 0. El coste de un documento es la suma de sus operaciones. Se calcula antes de ejecutar y se compara con `GQL_MAX_COMPLEXITY`.

---

## 3 · Cambios por archivo/módulo

| Archivo/módulo | Cambio |
|---|---|
| `apps/graphql/src/limits/depth.ts`, `aliases.ts` | Reglas de validación propias |
| `apps/graphql/src/limits/complexity.ts` | Estimador consciente de `first` sobre `graphql-query-complexity` |
| `apps/graphql/src/limits/index.ts` | Agrupa las reglas y los códigos de error |
| `apps/graphql/src/config.ts` | Variables `GQL_*` con valores por defecto |
| `apps/graphql/src/server.ts` | Instala las reglas, el límite de cuerpo, *batching* desactivado y la política de introspección |
| `apps/graphql/package.json` | Dependencia `graphql-query-complexity` |
| `.env.example`, `README.md` | Límites y su justificación; sección sobre por qué una API GraphQL sin límites es una denegación de servicio |

---

## 4 · Plan de tests

| Caso | Nivel | Cubre |
|---|---|---|
| Consulta legítima de referencia (`lot { auction { lots(first: 10) { title } } bids(first: 10) { edges { node { amount } } } }`) → aceptada | integración | Lo legítimo pasa |
| Consulta de profundidad 8 → rechazada con `QUERY_TOO_DEEP` y **sin ejecutar ningún resolver** (contador de consultas SQL a 0) | integración | Profundidad |
| Profundidad contada también a través de fragmentos (en línea y con nombre) | unit | Fragmentos |
| Un fragmento recursivo no cuelga el validador (se rechaza o se corta) | unit | Ciclos |
| `lots(first: 100) { bids(first: 100) { … } }` → `QUERY_TOO_COMPLEX` | integración | Complejidad con `first` |
| El mismo coste con `first: 1` → aceptada | unit | El coste depende del tamaño de página |
| 16 alias del mismo campo → `TOO_MANY_ALIASES`; 15 → aceptada | integración | Alias |
| Documento con más de 2 000 *tokens* → rechazado; cuerpo de más de 100 KB → 413 | integración | Tamaño |
| `first: 101`, `first: 0` y `first: -5` → `BAD_USER_INPUT` | integración | Tope de página |
| Un lote de consultas (array JSON) → rechazado | integración | *Batching* |
| Introspección: responde en `NODE_ENV=test`/`development` y se rechaza simulando producción | integración | Política de entorno |
| Los límites se leen del entorno y un valor inválido falla al arrancar | unit | Configuración |
| Las subscriptions se validan con las mismas reglas (una subscription demasiado profunda se rechaza) | integración | Aplica a todos los documentos |
| Los mensajes de error indican el límite y el valor, y en producción no contienen trazas | integración | Errores |

**Deliberadamente sin test:** rendimiento del validador con documentos del tamaño máximo; consultas persistidas.

---

## 5 · Definition of Done

- [ ] SDD en `docs/sdd/E2/SDD.md`, Estado = Aprobado
- [ ] Profundidad, complejidad (con `first`), alias, tamaño y *batching* limitados y probados
- [ ] Un documento rechazado no ejecuta resolvers
- [ ] Introspección según entorno; errores sin detalles internos
- [ ] README explica los tres límites y por qué (spec §7)
- [ ] Tests del §4 en verde; `npm run check` y `npm run test:integration` en verde
- [ ] PR con CI verde y fusionado

---

## 6 · Riesgos

| Riesgo | Gravedad | Mitigación |
|---|---|---|
| Límites demasiado estrictos rechazan consultas legítimas de clientes | Media | Valores derivados de consultas reales del esquema, errores que indican el límite y todo configurable |
| Un coste mal calculado deja pasar consultas caras | Alta | Pruebas con el peor caso permitido y medición del número de consultas SQL; el tope de `first` actúa como segunda barrera |
| Un fallo en la regla propia de profundidad (fragmentos, ciclos) | Media | Pruebas específicas con fragmentos anidados y recursivos |
| Desactivar la introspección en producción molesta a quien explora la API | Baja | El SDL está en el repositorio y en el README |
| Los límites no frenan a un cliente que lanza muchas consultas baratas | Media | Es limitación de tasa (F2), fuera de alcance |

---

## 7 · Preguntas abiertas

1. **Reglas propias para profundidad y alias** y `graphql-query-complexity` para el coste (propuesta). La alternativa, `@escape.tech/graphql-armor`, resolvería profundidad, alias y *tokens* con una dependencia pero no se actualiza desde diciembre de 2025 y no multiplica por el tamaño de página. ¿De acuerdo?
2. **Valores por defecto** de §2.2 (7, 1 000, 15, 2 000, 100 KB, 100). ¿Los ajustamos?
3. **Introspección desactivada en producción** (propuesta), con el SDL publicado en el repositorio. ¿O prefieres dejarla siempre activa por ser un proyecto de portafolio?
4. **`first` fuera de rango rechazado** con `BAD_USER_INPUT` (propuesta) en lugar de recortarlo en silencio. ¿De acuerdo?
5. **Consultas persistidas** como evolución futura, no ahora. ¿De acuerdo?
