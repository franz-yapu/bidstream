# Infraestructura Azure (H1)

Bicep de la spec §9: **Event Hubs** (Kafka), **PostgreSQL Flexible**, **Key Vault**, **ACR**,
**Log Analytics** y **Container Apps** con los ocho procesos de `apps/` y el front (`web`, con entrada externa). Es infraestructura como
código, **no** un despliegue hecho: H3 (publicar imágenes) y H4 (métricas) siguen pendientes y Q1
(suscripción y presupuesto) sigue abierto.

## Qué se crea

| Recurso                | Detalle                                                                                                                                                                                                                              |
| ---------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| Event Hubs             | Namespace Standard, 3 hubs: `bidstream.commands.bid` (6 particiones), `bidstream.events.lot` (6) y `bidstream.events.lot.dlq` (1), con los grupos `projector`, `notifier`, `auditor`, `decider`, `decider-state` y `dlq-reprocessor` |
| PostgreSQL Flexible 16 | Base `bidstream`, Burstable B1ms, 32 GB, TLS obligatorio y firewall de servicios de Azure                                                                                                                                            |
| Key Vault              | RBAC, soft delete y purge protection; secretos de base, Event Hubs, JWT, firma y admin inicial                                                                                                                                       |
| ACR                    | SKU Basic, sin usuario administrador; las apps tiran con identidad administrada (`AcrPull`)                                                                                                                                          |
| Container Apps         | `api` y `graphql` con ingress externo; `relay`, `projector`, `notifier`, `auditor`, `decider` y `closer` internos                                                                                                                    |
| Log Analytics          | Retención de 30 días; base para H4                                                                                                                                                                                                   |

**Límite importante:** Event Hubs no soporta compactación y la retención máxima es de **7 días en
Standard** (90 en Premium). El «log ilimitado» de la spec no existe en este servicio: un reproceso
completo más allá de la retención requerirá exportar `events.lot` a Storage o subir de SKU. Está
parametrizado en `eventsRetentionDays`/`dlqRetentionDays` y `eventHubsSku`.

## Antes de desplegar

- Azure CLI con Bicep (`az bicep install`) y sesión iniciada (`az login`).
- Un grupo de recursos y presupuesto aprobados (**Q1**).
- Claves Ed25519 de despliegue: `node scripts/generate-keys.mjs --kid azure-1`. Los archivos
  `.env.*` no se versionan.

```bash
export POSTGRES_ADMIN_PASSWORD="$(openssl rand -base64 24)"
set -a
source .env.auth.private .env.auth.public .env.signing.private .env.signing.public
set +a
cp infra/main.bicepparam.example infra/main.bicepparam
az group create -n bidstream-rg -l westeurope
az bicep build --file infra/main.bicep   # validación sintáctica obligatoria
az deployment group create -g bidstream-rg -f infra/main.bicep -p infra/main.bicepparam
```

Los secretos viajan como parámetros `@secure()` (no se guardan en el historial de despliegue) y
terminan en Key Vault. Las Container Apps los leen por referencia con su identidad administrada.

## Publicar imágenes (H3)

H1 deja el registro y las apps creadas, pero no publica imágenes. Con las imágenes construidas por
H2:

```bash
az acr login -n "$(az deployment group show -g bidstream-rg -n main --query properties.outputs.acrLoginServer.value -o tsv)"
for app in api relay projector auditor notifier graphql decider closer; do
  docker build --build-arg APP="$app" -t "bidstream-$app:latest" .
  docker tag "bidstream-$app:latest" "<acr>/bidstream-$app:latest"
  docker push "<acr>/bidstream-$app:latest"
done
```

Después vuelve a desplegar con `imageTag` (por defecto `latest`) o deja que H3 lo automatice.

## Coste y apagado

Event Hubs y PostgreSQL cobran **por hora**. Para la demo: levantar, grabar/documentar y apagar.

```bash
# Apagar PostgreSQL (deja de cobrar cómputo; el almacenamiento sigue)
az postgres flexible-server stop -g bidstream-rg -n <servidor>

# Borrar todo el entorno y los datos
az group delete -n bidstream-rg --yes --no-wait
```

## Después de desplegar

- El DNS de GraphQL/API y los puertos 3000/4000 salen en las Container Apps.
- Carga las claves públicas/privadas rotadas en Key Vault y reinicia las revisiones; el `kid` de las
  variables debe coincidir con el de las claves.
- Los logs van a Log Analytics; las métricas de consumer lag (H4) todavía no existen.
- La red es pública con firewall de servicios de Azure. Private Endpoints y alta disponibilidad son
  una revisión posterior de producción.
