// Infraestructura de bidstream en Azure (spec §9). Se despliega en un grupo de recursos:
//   az deployment group create -g <rg> -f infra/main.bicep -p infra/main.bicepparam
// Los secretos llegan como parámetros @secure() y terminan en Key Vault; nunca se versionan.
// Event Hubs/PostgreSQL cobran por hora: ver infra/README.md antes de desplegar.

targetScope = 'resourceGroup'

@minLength(2)
@maxLength(8)
@description('Prefijo de nombres (minúsculas, números y guiones).')
param namePrefix string = 'bids'

@description('Región de Azure.')
param location string = resourceGroup().location

@description('Usuario administrador de PostgreSQL.')
param postgresAdminLogin string = 'bidstream'

@secure()
@description('Contraseña del administrador de PostgreSQL.')
param postgresAdminPassword string

@secure()
@description('Clave privada Ed25519 que emite los JWT (API).')
param authJwtPrivateKey string

@secure()
@description('Claves públicas Ed25519 para verificar JWT (JSON {kid: PEM}).')
param authJwtPublicKeys string

@secure()
@description('Clave privada Ed25519 que firma los eventos (relay).')
param eventSigningPrivateKey string

@secure()
@description('Claves públicas Ed25519 para verificar eventos (JSON {kid: PEM}).')
param eventVerificationKeys string

@secure()
@description('Contraseña del administrador inicial.')
param bootstrapAdminPassword string

@description('Tenant del administrador inicial.')
param bootstrapAdminTenantId string

@description('Correo del administrador inicial.')
param bootstrapAdminEmail string

@description('kid de la clave que emite JWT.')
param authJwtKeyId string = 'azure-1'

@description('kid de la clave que firma eventos.')
param eventSigningKeyId string = 'azure-1'

@description('Corte para aceptar eventos sin firma del historial (ISO 8601).')
param eventSigningRequiredFrom string = '2026-11-13T00:00:00.000Z'

@description('Orígenes CORS permitidos (vacío = ninguno).')
param corsAllowedOrigins string = ''

@description('Tag de las imágenes publicadas por H3.')
param imageTag string = 'latest'

@allowed(['Basic', 'Standard', 'Premium'])
param acrSku string = 'Basic'

@allowed(['Standard', 'Premium'])
@description('SKU de Event Hubs. Standard basta para la demo; Premium permite 90 días de retención.')
param eventHubsSku string = 'Standard'

@minValue(1)
param eventHubsCapacity int = 1

@minValue(1)
@maxValue(90)
@description('Retención de events.lot en días (máximo 7 en Standard).')
param eventsRetentionDays int = 7

@minValue(1)
@maxValue(90)
@description('Retención del DLQ en días (máximo 7 en Standard).')
param dlqRetentionDays int = 7

@description('SKU de PostgreSQL Flexible.')
param postgresSku string = 'Standard_B1ms'

@minValue(32)
@maxValue(1024)
param postgresStorageGB int = 32

@minValue(0)
param apiMinReplicas int = 1

@minValue(1)
param apiMaxReplicas int = 3

@minValue(0)
param graphqlMinReplicas int = 1

@minValue(1)
param graphqlMaxReplicas int = 3

var suffix = uniqueString(resourceGroup().id)
var safePrefix = toLower(namePrefix)
var acrName = take('acr${replace(safePrefix, '-', '')}${suffix}', 50)
var keyVaultName = take('kv-${safePrefix}-${suffix}', 24)
var eventHubsName = take('evhns-${safePrefix}-${suffix}', 50)
var postgresName = take('psql-${safePrefix}-${suffix}', 63)
var environmentName = take('cae-${safePrefix}-${suffix}', 32)
var identityName = take('id-${safePrefix}-${suffix}', 128)

module eventHubs 'modules/eventhubs.bicep' = {
  name: 'eventHubs'
  params: {
    namespaceName: eventHubsName
    location: location
    sku: eventHubsSku
    capacity: eventHubsCapacity
    eventsRetentionDays: eventsRetentionDays
    dlqRetentionDays: dlqRetentionDays
  }
}

module postgres 'modules/postgres.bicep' = {
  name: 'postgres'
  params: {
    serverName: postgresName
    location: location
    adminLogin: postgresAdminLogin
    adminPassword: postgresAdminPassword
    skuName: postgresSku
    storageSizeGB: postgresStorageGB
  }
}

module acr 'modules/acr.bicep' = {
  name: 'acr'
  params: {
    registryName: acrName
    location: location
    sku: acrSku
  }
}

module keyVault 'modules/keyvault.bicep' = {
  name: 'keyVault'
  params: {
    vaultName: keyVaultName
    location: location
    postgresHost: postgres.outputs.host
    postgresAdminLogin: postgresAdminLogin
    postgresAdminPassword: postgresAdminPassword
    postgresDatabase: postgres.outputs.databaseName
    eventHubsNamespaceName: eventHubsName
    eventHubsRuleName: 'bidstream-app'
    authJwtPrivateKey: authJwtPrivateKey
    authJwtPublicKeys: authJwtPublicKeys
    eventSigningPrivateKey: eventSigningPrivateKey
    eventVerificationKeys: eventVerificationKeys
    bootstrapAdminPassword: bootstrapAdminPassword
  }
  dependsOn: [eventHubs]
}

resource identity 'Microsoft.ManagedIdentity/userAssignedIdentities@2023-01-31' = {
  name: identityName
  location: location
}

// Referencias para asignar roles sobre recursos creados por módulos (el despliegue espera al módulo).
resource acrRef 'Microsoft.ContainerRegistry/registries@2023-07-01' existing = {
  name: acrName
}

resource keyVaultRef 'Microsoft.KeyVault/vaults@2023-07-01' existing = {
  name: keyVaultName
}

// ACR: las apps solo pueden descargar imágenes, no publicarlas.
resource acrPull 'Microsoft.Authorization/roleAssignments@2022-04-01' = {
  name: guid(acrRef.id, identity.id, '7f951dda-4ed3-4680-a7ca-43fe172d538d')
  scope: acrRef
  properties: {
    roleDefinitionId: subscriptionResourceId(
      'Microsoft.Authorization/roleDefinitions',
      '7f951dda-4ed3-4680-a7ca-43fe172d538d'
    )
    principalId: identity.properties.principalId
    principalType: 'ServicePrincipal'
  }
  dependsOn: [acr]
}

// Key Vault Secrets User: solo leer los secretos referenciados por las Container Apps.
resource keyVaultSecretsUser 'Microsoft.Authorization/roleAssignments@2022-04-01' = {
  name: guid(keyVaultRef.id, identity.id, '4633458b-17de-408a-b874-0445c86b69e6')
  scope: keyVaultRef
  properties: {
    roleDefinitionId: subscriptionResourceId(
      'Microsoft.Authorization/roleDefinitions',
      '4633458b-17de-408a-b874-0445c86b69e6'
    )
    principalId: identity.properties.principalId
    principalType: 'ServicePrincipal'
  }
  dependsOn: [keyVault]
}

module containerApps 'modules/containerapps.bicep' = {
  name: 'containerApps'
  params: {
    namePrefix: safePrefix
    location: location
    environmentName: environmentName
    identityId: identity.id
    acrLoginServer: acr.outputs.loginServer
    imageTag: imageTag
    keyVaultUri: keyVault.outputs.vaultUri
    eventHubsNamespaceName: eventHubsName
    corsAllowedOrigins: corsAllowedOrigins
    eventSigningRequiredFrom: eventSigningRequiredFrom
    authJwtKeyId: authJwtKeyId
    eventSigningKeyId: eventSigningKeyId
    bootstrapAdminTenantId: bootstrapAdminTenantId
    bootstrapAdminEmail: bootstrapAdminEmail
    apiMinReplicas: apiMinReplicas
    apiMaxReplicas: apiMaxReplicas
    graphqlMinReplicas: graphqlMinReplicas
    graphqlMaxReplicas: graphqlMaxReplicas
  }
  dependsOn: [
    acrPull
    keyVaultSecretsUser
  ]
}

output acrLoginServer string = acr.outputs.loginServer
output keyVaultUri string = keyVault.outputs.vaultUri
output eventHubsHost string = eventHubs.outputs.namespaceHost
output postgresHost string = postgres.outputs.host
output containerAppsEnvironmentId string = containerApps.outputs.environmentId
output identityPrincipalId string = identity.properties.principalId
