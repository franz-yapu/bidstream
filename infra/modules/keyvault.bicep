// Key Vault con RBAC y secretos de la aplicación (spec §8 y §9). Bicep genera las cadenas de conexión
// y guarda las claves Ed25519 que el operador pasa como parámetros seguros: nunca se versionan ni se
// escriben en el manifiesto de Container Apps.

@description('Nombre del Key Vault.')
param vaultName string

@description('Región de Azure.')
param location string

@description('Host de PostgreSQL.')
param postgresHost string

@description('Usuario administrador de PostgreSQL.')
param postgresAdminLogin string

@secure()
@description('Contraseña del administrador de PostgreSQL.')
param postgresAdminPassword string

@description('Base de datos de la aplicación.')
param postgresDatabase string

@description('Namespace de Event Hubs.')
param eventHubsNamespaceName string

@description('Regla de autorización de Event Hubs.')
param eventHubsRuleName string

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

resource vault 'Microsoft.KeyVault/vaults@2023-07-01' = {
  name: vaultName
  location: location
  properties: {
    tenantId: tenant().tenantId
    sku: {
      family: 'A'
      name: 'standard'
    }
    enableRbacAuthorization: true
    enableSoftDelete: true
    softDeleteRetentionInDays: 7
    enablePurgeProtection: true
    publicNetworkAccess: 'Enabled'
    networkAcls: {
      defaultAction: 'Allow'
      bypass: 'AzureServices'
    }
  }
}

resource eventHubsNamespace 'Microsoft.EventHub/namespaces@2024-01-01' existing = {
  name: eventHubsNamespaceName
}

resource eventHubsRule 'Microsoft.EventHub/namespaces/authorizationRules@2024-01-01' existing = {
  parent: eventHubsNamespace
  name: eventHubsRuleName
}

// `sslmode=require` mantiene TLS también en la cadena (A02).
var databaseUrl = 'postgresql://${postgresAdminLogin}:${uriComponent(postgresAdminPassword)}@${postgresHost}:5432/${postgresDatabase}?sslmode=require'

resource databaseUrlSecret 'Microsoft.KeyVault/vaults/secrets@2023-07-01' = {
  parent: vault
  name: 'database-url'
  properties: {
    value: databaseUrl
    contentType: 'text/plain'
  }
}

// El cliente de Kafka usa `$ConnectionString` como usuario y esta cadena como contraseña.
resource eventHubsSecret 'Microsoft.KeyVault/vaults/secrets@2023-07-01' = {
  parent: vault
  name: 'eventhubs-connection-string'
  properties: {
    value: eventHubsRule.listKeys().primaryConnectionString
    contentType: 'text/plain'
  }
}

resource authJwtPrivateSecret 'Microsoft.KeyVault/vaults/secrets@2023-07-01' = {
  parent: vault
  name: 'auth-jwt-private-key'
  properties: {
    value: authJwtPrivateKey
  }
}

resource authJwtPublicSecret 'Microsoft.KeyVault/vaults/secrets@2023-07-01' = {
  parent: vault
  name: 'auth-jwt-public-keys'
  properties: {
    value: authJwtPublicKeys
  }
}

resource eventSigningPrivateSecret 'Microsoft.KeyVault/vaults/secrets@2023-07-01' = {
  parent: vault
  name: 'event-signing-private-key'
  properties: {
    value: eventSigningPrivateKey
  }
}

resource eventVerificationSecret 'Microsoft.KeyVault/vaults/secrets@2023-07-01' = {
  parent: vault
  name: 'event-verification-keys'
  properties: {
    value: eventVerificationKeys
  }
}

resource bootstrapAdminSecret 'Microsoft.KeyVault/vaults/secrets@2023-07-01' = {
  parent: vault
  name: 'bootstrap-admin-password'
  properties: {
    value: bootstrapAdminPassword
  }
}

output vaultUri string = vault.properties.vaultUri
