# SDD — H1 · Infraestructura Azure en Bicep (sin desplegar)

- **Ticket:** H1 (8 h, Tier 🛑 por Q1). **Alcance acordado:** escribir la infraestructura como código y sus pruebas; **no** desplegar (H3/H4 siguen bloqueados).
- **Autor:** generado con Claude (Entregable 1).
- **Estado:** Implementado (2026-11-13) — código y pruebas; despliegue pendiente de Q1.
- **Versión:** 0.1 · **Fecha:** 2026-11-13
- **Depende de:** 0.2 (entorno local), H2 (imágenes), F1/F3 (secretos de autenticación y firma).
- **Fuentes de verdad citadas:** spec §4 (topics y grupos), §9 (servicios y coste), §8 (TLS/Key Vault); `CLAUDE.md` (nombres de variables y grupos); `.env.example`; [ADR-0012](../adr/0012-firma-ed25519-de-eventos.md), [ADR-0013](../adr/0013-autenticacion-propia-y-rbac.md).

---

## 0 · Preguntas que el ticket pidió cerrar

| # | Pregunta | Respuesta |
|---|---|---|
| 1 | ¿Se puede hacer H1 sin suscripción Azure? | **Sí para el código**: Bicep se escribe y se prueba estructuralmente. El `bicep build` real y el despliegue (H3) necesitan Azure CLI/Bicep y Q1. |
| 2 | ¿Event Hubs sirve como log con retención ilimitada? | **No**: no hay *compaction* y la retención máxima es 7 días (Standard) o 90 (Premium). Se parametriza; el límite queda documentado como deuda de H1. |
| 3 | ¿Cómo se pasan los secretos a Container Apps? | Referencias a **Key Vault** con identidad administrada. Bicep crea las cadenas de conexión; las claves Ed25519 y el admin inicial los carga el operador. Nunca en el repositorio ni en el historial de despliegue. |

---

## 1 · Alcance

### Entra

- `infra/` con `main.bicep` y módulos: **Event Hubs** (namespace Kafka + 3 hubs + grupos), **PostgreSQL Flexible 16**, **Key Vault** (RBAC), **ACR** (sin admin), **Container Apps** (8 procesos, con **Log Analytics** dentro del módulo), **identidad administrada** y asignaciones de rol.
- Topics con las particiones de la spec: `bidstream.commands.bid` (6), `bidstream.events.lot` (6), `bidstream.events.lot.dlq` (1), y grupos `projector`, `notifier`, `auditor`, `decider`, `decider-state`, `dlq-reprocessor`.
- Secretos: `database-url` y `eventhubs-connection-string` generados por Bicep; `AUTH_JWT_*`, `EVENT_*`, `BOOTSTRAP_ADMIN_PASSWORD` cargados por el operador en Key Vault.
- Solo API y GraphQL con ingress externo; el resto interno. Procesos de liderazgo (`relay`, `closer`, `decider`) con una réplica.
- Prueba de documentación/infraestructura que cruza los archivos Bicep con los procesos reales de `apps/`.
- `infra/README.md` con despliegue, carga de secretos, coste y apagado.

### No entra

- **Desplegar** ni validar contra Azure (`az deployment group what-if`): H3/H4 y Q1.
- Pipeline de publicación de imágenes (H3), métricas/alertas (H4), Grafana.
- Red privada/VNet, Private Endpoints, alta disponibilidad de PostgreSQL (coste); se documentan como evolución.
- Rotación automática de claves Ed25519 y sellado del historial (deuda de F3).

### Premisas verificadas

| Premisa | Qué hay de verdad |
|---|---|
| Existe `infra/` o Bicep | No: no hay carpeta ni plantillas. |
| Hay Azure CLI o Bicep instalado | No (`az` y `bicep` no están en el entorno): no se puede ejecutar `bicep build` aquí. |
| Los procesos y sus variables están definidos | Sí: 8 apps en `apps/`, con `DATABASE_URL`, `KAFKA_*`, `AUTH_*`, `EVENT_*` y puertos 3000/4000 verificados. |
| Las imágenes existen | Sí: `Dockerfile` con `ARG APP` (H2); aquí solo se referencia el registro y el tag. |
| Event Hubs es Kafka con retención ilimitada | No: protocolo Kafka sí; retención limitada y sin compactación. |

---

## 2 · Diseño técnico

| Decisión | Elección | Por qué |
|---|---|---|
| Estructura | `main.bicep` + un módulo por servicio; `targetScope = 'resourceGroup'` | Legible, testeable y desplegable con un solo comando. |
| Nombres | `uniqueString(resourceGroup().id)` | Evita colisiones sin parámetros extra. |
| Event Hubs | SKU Standard (parametrizable a Premium) y retención por parámetro (7 días por defecto) | Coste controlado; Premium solo si se necesita retención de 90 días. Se documenta que el «log ilimitado» no existe en Event Hubs. |
| Autorización de Event Hubs | Regla de namespace `bidstream-app` con Send+Listen; sin Manage para las apps | La cadena se guarda en Key Vault; el relay y los consumidores comparten el secreto. |
| PostgreSQL | Flexible 16, Burstable B1ms, 32 GB, 7 días de backup, TLS obligatorio (`require_secure_transport=ON`) y firewall «servicios de Azure» | Barato para la demo; red privada queda como evolución. |
| Secretos de apps | `configuration.secrets` de Container Apps con `keyVaultUrl` + identidad administrada | La cadena no viaja en el manifiesto de la app; rotar es cambiar el secreto. |
| Identidad | Una identidad asignada por usuario con `AcrPull` sobre ACR y `Key Vault Secrets User` sobre el vault | Sin credenciales de ACR ni de Key Vault en las apps. |
| Ingress | API (`/v1/health`) y GraphQL (`/health`) externos; consumidores sin ingress | Superficie mínima. |
| Réplicas | API/GraphQL 1–3; relay/closer/decider 1; consumidores 1 | El liderazgo y el orden por partición no ganan con réplicas; se evita el coste. |
| Claves Ed25519 | No se generan en Bicep; el operador las carga en Key Vault | Evita secretos en el historial de despliegue y permite rotación por `kid`. |
| Logs | Log Analytics `PerGB2018` y entorno de Container Apps conectado | Base para H4 sin adelantar Grafana. |

**Mapa de apps** (el test lo cruza con `apps/`):

| App | Ingress | Secretos que referencia |
|---|---|---|
| `api` | externo 3000 | `database-url`, `auth-jwt-private-key`, `auth-jwt-public-keys`, `bootstrap-admin-password`, Kafka |
| `graphql` | externo 4000 | `database-url`, `auth-jwt-public-keys` |
| `relay` | — | `database-url`, `event-signing-private-key`, Kafka |
| `projector`, `notifier`, `auditor` | — | `database-url`, `event-verification-keys`, Kafka |
| `decider` | — | `database-url`, `event-verification-keys`, Kafka |
| `closer` | — | `database-url` |

**Limitaciones honestas.** Event Hubs no compacta y su retención máxima es 7 días en Standard; un reproceso completo más allá de la retención no es posible. La solución real (exportar `events.lot` a Storage o usar Premium) es una decisión de coste que pertenece a Q1/H1-futuro. El documento de seguridad ya marca TLS/Key Vault como 🟡 hasta que esto se despliegue.

---

## 3 · Cambios por archivo/módulo

| Archivo | Cambio |
|---|---|
| `infra/main.bicep` | **Nuevo.** Parámetros, módulos, identidad, roles y secretos base. |
| `infra/modules/eventhubs.bicep` | Namespace, hubs, grupos y regla de autorización. |
| `infra/modules/postgres.bicep` | Servidor, base, TLS y firewall. |
| `infra/modules/keyvault.bicep` | Vault con RBAC y secretos generados. |
| `infra/modules/acr.bicep` | Registro sin usuario admin. |
| `infra/modules/containerapps.bicep` | Log Analytics, entorno y los 8 procesos con ingress, secretos y escala. |
| `infra/main.bicepparam.example` | Ejemplo de parámetros; las contraseñas se leen del entorno. |
| `infra/README.md` | Despliegue, secretos del operador, coste y apagado. |
| `packages/testing/src/infra/bicep.test.ts` | **Nuevo.** Estructura, recursos obligatorios, apps vs. `apps/`, secretos y enlaces. |
| `docs/sdd/H1/SDD.md` | Este documento. |
| `docs/planning/...Sprint-Roadmap.md` y `docs/decisions/LOG.md` | H1 pasa a 🟡 «Bicep listo, sin desplegar» y `DEC-054`. |

---

## 4 · Plan de tests

| Caso | Nivel | Cubre |
|---|---|---|
| Existen `main.bicep`, los 6 módulos, README y ejemplo de parámetros | unit | Estructura |
| Cada módulo declara los recursos de la spec (Event Hubs, PostgreSQL, Key Vault, ACR, Container Apps) | unit | Cobertura de §9 |
| Los 3 hubs tienen las particiones de la spec y los 6 grupos de consumo | unit | §4 |
| Key Vault usa RBAC, soft delete y purge protection; ACR no tiene admin | unit | Seguridad |
| PostgreSQL exige TLS | unit | §8 (A02) |
| Cada app de `apps/` tiene su Container App; solo API/GraphQL tienen ingress externo | unit | Procesos reales |
| Las apps referencian Key Vault, no literales de contraseña | unit | Sin secretos en el manifiesto |
| El README enlaza y advierte del coste | unit | Operación |

**No se testea en CI** la validez sintáctica real (requiere el CLI de Bicep) ni el despliegue; queda para H3. En local se validó con Bicep 0.49.2 (`bicep build` sin errores) y el README exige `az bicep build` antes de desplegar. El test estructural es una barrera, no un sustituto de esa validación.

---

## 5 · Definition of Done

- [ ] SDD aprobado.
- [ ] `infra/` completo con módulos, parámetros de ejemplo y README.
- [ ] Prueba `bicep.test.ts` en verde y `npm run check` en verde.
- [ ] `DEC-054` y roadmap con H1 en 🟡 (código listo, despliegue pendiente de Q1).
- [ ] Sin secretos reales en el repo.
- [ ] PR fusionado.

---

## 6 · Riesgos

| Riesgo | Gravedad | Mitigación |
|---|---|---|
| Bicep con un error de sintaxis que el test estructural no detecta | Alta | `az bicep build`/`what-if` como paso obligatorio antes de H3; documentado en `infra/README.md` |
| Coste de Event Hubs/PostgreSQL si se olvida apagar | Alta | SKU mínimos, retención corta, pasos de apagado/borrado en el README |
| Retención de 7 días rompe el reproceso histórico | Media | Parámetro de SKU/retención y deuda explícita en el SDD y `SECURITY.md` |
| Contraseña de PostgreSQL en el historial de despliegue | Media | Parámetro `@secure()` leído del entorno, no del archivo de parámetros |
| Secretos Ed25519 ausentes y apps que no arrancan | Media | README con el orden: desplegar → cargar secretos → reiniciar revisiones |

---

## 7 · Preguntas abiertas

1. **Q1** sigue abierta: sin suscripción/presupuesto no hay `what-if` ni despliegue. El código queda listo para cuando exista.
2. **Retención de `events.lot`:** 7 días (Standard) o 90 (Premium). Propuesta: Standard para la demo y documentar la deuda.
3. **Red privada:** PostgreSQL y Event Hubs públicos con firewall de Azure para la demo; Private Endpoints quedan para una revisión de producción.

---

## Changelog de implementación

- `infra/main.bicep` + `modules/{eventhubs,postgres,keyvault,acr,containerapps}.bicep`, `main.bicepparam.example` e `infra/README.md`.
- Event Hubs: 3 hubs con 6/6/1 particiones y los 6 grupos reales; retención parametrizable y sin compactación (límite documentado). PostgreSQL 16 con TLS obligatorio; Key Vault con RBAC; ACR sin admin; Container Apps para los 8 procesos, solo API/GraphQL externos, secretos por referencia a Key Vault con identidad administrada.
- Secretos como parámetros `@secure()`; `.gitignore` excluye `infra/main.bicepparam` y `main.json`.
- `packages/testing/src/infra/bicep.test.ts` (15 pruebas). `bicep build` validado en local con 0.49.2; **no** se desplegó ni se ejecutó `what-if` (sin Azure CLI ni Q1).
