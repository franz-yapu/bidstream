// Container Apps (spec §9): un proceso por app de `apps/`. API, GraphQL y el front son los únicos con
// entrada externa; relay, decisor, closer y consumidores viven en la red interna del entorno.
// Los secretos se resuelven desde Key Vault con la identidad administrada, nunca como literales.

@description('Prefijo de nombres.')
param namePrefix string

@description('Región de Azure.')
param location string

@description('Nombre del entorno de Container Apps.')
param environmentName string

@description('Id de la identidad administrada con AcrPull y Key Vault Secrets User.')
param identityId string

@description('Servidor de login de ACR.')
param acrLoginServer string

@description('Tag de las imágenes.')
param imageTag string = 'latest'

@description('URI del Key Vault (termina en /).')
param keyVaultUri string

@description('Namespace de Event Hubs.')
param eventHubsNamespaceName string

@description('Orígenes CORS permitidos (vacío = ninguno).')
param corsAllowedOrigins string = ''

@description('URL pública de la API REST que verá el navegador (https://…, sin barra final). La usa el front.')
param webApiUrl string

@description('URL pública del endpoint GraphQL que verá el navegador (https://…/graphql). La usa el front.')
param webGraphqlUrl string

@description('Corte para aceptar eventos sin firma del historial.')
param eventSigningRequiredFrom string

@description('kid de la clave que emite JWT.')
param authJwtKeyId string

@description('kid de la clave que firma eventos.')
param eventSigningKeyId string

@description('Tenant del administrador inicial.')
param bootstrapAdminTenantId string

@description('Correo del administrador inicial.')
param bootstrapAdminEmail string

@minValue(0)
param apiMinReplicas int = 1

@minValue(1)
param apiMaxReplicas int = 3

@minValue(0)
param graphqlMinReplicas int = 1

@minValue(1)
param graphqlMaxReplicas int = 3

var workspaceName = take('log-${namePrefix}-${uniqueString(resourceGroup().id)}', 63)

var kafkaEnv = [
  {
    name: 'KAFKA_BROKERS'
    value: '${eventHubsNamespaceName}.servicebus.windows.net:9093'
  }
  {
    name: 'KAFKA_SECURITY_PROTOCOL'
    value: 'SASL_SSL'
  }
  {
    name: 'KAFKA_SASL_USERNAME'
    value: '$ConnectionString'
  }
  {
    name: 'KAFKA_SASL_PASSWORD'
    secretRef: 'eventhubs-connection-string'
  }
]

var databaseEnv = [
  {
    name: 'DATABASE_URL'
    secretRef: 'database-url'
  }
]

// Firma y verificación de eventos (F3): en producción no se aceptan mensajes sin firma.
var eventVerificationEnv = [
  {
    name: 'EVENT_SIGNATURE_MODE'
    value: 'enforce'
  }
  {
    name: 'EVENT_SIGNING_REQUIRED_FROM'
    value: eventSigningRequiredFrom
  }
  {
    name: 'EVENT_VERIFICATION_KEYS'
    secretRef: 'event-verification-keys'
  }
]

var commonProductionEnv = [
  {
    name: 'NODE_ENV'
    value: 'production'
  }
  {
    name: 'LOG_LEVEL'
    value: 'info'
  }
]

var apps = [
  {
    name: 'api'
    external: true
    targetPort: 3000
    minReplicas: apiMinReplicas
    maxReplicas: apiMaxReplicas
    secrets: [
      'database-url'
      'eventhubs-connection-string'
      'auth-jwt-private-key'
      'auth-jwt-public-keys'
      'bootstrap-admin-password'
    ]
    env: concat(
      commonProductionEnv,
      databaseEnv,
      kafkaEnv,
      [
        { name: 'AUTH_MODE', value: 'jwt' }
        { name: 'AUTH_JWT_KEY_ID', value: authJwtKeyId }
        { name: 'AUTH_JWT_PRIVATE_KEY', secretRef: 'auth-jwt-private-key' }
        { name: 'AUTH_JWT_PUBLIC_KEYS', secretRef: 'auth-jwt-public-keys' }
        { name: 'BOOTSTRAP_ADMIN_TENANT_ID', value: bootstrapAdminTenantId }
        { name: 'BOOTSTRAP_ADMIN_EMAIL', value: bootstrapAdminEmail }
        { name: 'BOOTSTRAP_ADMIN_PASSWORD', secretRef: 'bootstrap-admin-password' }
        { name: 'CORS_ALLOWED_ORIGINS', value: corsAllowedOrigins }
        { name: 'HOST', value: '0.0.0.0' }
        { name: 'PORT', value: '3000' }
      ]
    )
  }
  {
    name: 'graphql'
    external: true
    targetPort: 4000
    minReplicas: graphqlMinReplicas
    maxReplicas: graphqlMaxReplicas
    secrets: ['database-url', 'auth-jwt-public-keys']
    env: concat(
      commonProductionEnv,
      databaseEnv,
      [
        { name: 'AUTH_MODE', value: 'jwt' }
        { name: 'AUTH_JWT_PUBLIC_KEYS', secretRef: 'auth-jwt-public-keys' }
        { name: 'CORS_ALLOWED_ORIGINS', value: corsAllowedOrigins }
        { name: 'GQL_INTROSPECTION', value: 'false' }
        { name: 'HOST', value: '0.0.0.0' }
        { name: 'GRAPHQL_PORT', value: '4000' }
      ]
    )
  }
  {
    // Front (J1): SPA estática con nginx sin privilegios; las URL se validan al arrancar.
    name: 'web'
    external: true
    targetPort: 8080
    minReplicas: 1
    maxReplicas: 2
    secrets: []
    env: [
      { name: 'API_URL', value: webApiUrl }
      { name: 'GRAPHQL_URL', value: webGraphqlUrl }
      { name: 'DEFAULT_TENANT_ID', value: bootstrapAdminTenantId }
    ]
  }
  {
    name: 'relay'
    external: false
    targetPort: 0
    minReplicas: 1
    maxReplicas: 1
    secrets: ['database-url', 'eventhubs-connection-string', 'event-signing-private-key']
    env: concat(
      commonProductionEnv,
      databaseEnv,
      kafkaEnv,
      [
        { name: 'EVENT_SIGNING_KEY_ID', value: eventSigningKeyId }
        { name: 'EVENT_SIGNING_PRIVATE_KEY', secretRef: 'event-signing-private-key' }
      ]
    )
  }
  {
    name: 'projector'
    external: false
    targetPort: 0
    minReplicas: 1
    maxReplicas: 1
    secrets: ['database-url', 'eventhubs-connection-string', 'event-verification-keys']
    env: concat(
      commonProductionEnv,
      databaseEnv,
      kafkaEnv,
      eventVerificationEnv,
      [
        { name: 'PROJECTOR_GROUP_ID', value: 'projector' }
        { name: 'PROJECTOR_TOPIC', value: 'bidstream.events.lot' }
      ]
    )
  }
  {
    name: 'notifier'
    external: false
    targetPort: 0
    minReplicas: 1
    maxReplicas: 1
    secrets: ['database-url', 'eventhubs-connection-string', 'event-verification-keys']
    env: concat(commonProductionEnv, databaseEnv, kafkaEnv, eventVerificationEnv)
  }
  {
    name: 'auditor'
    external: false
    targetPort: 0
    minReplicas: 1
    maxReplicas: 1
    secrets: ['database-url', 'eventhubs-connection-string', 'event-verification-keys']
    env: concat(commonProductionEnv, databaseEnv, kafkaEnv, eventVerificationEnv)
  }
  {
    name: 'decider'
    external: false
    targetPort: 0
    minReplicas: 1
    maxReplicas: 1
    secrets: ['database-url', 'eventhubs-connection-string', 'event-verification-keys']
    env: concat(
      commonProductionEnv,
      databaseEnv,
      kafkaEnv,
      eventVerificationEnv,
      [
        { name: 'ANTI_SNIPING_WINDOW_MS', value: '120000' }
        { name: 'ANTI_SNIPING_EXTENSION_MS', value: '120000' }
      ]
    )
  }
  {
    name: 'closer'
    external: false
    targetPort: 0
    minReplicas: 1
    maxReplicas: 1
    secrets: ['database-url']
    env: concat(commonProductionEnv, databaseEnv, [{ name: 'CLOSER_POLL_MS', value: '5000' }])
  }
]

resource workspace 'Microsoft.OperationalInsights/workspaces@2023-09-01' = {
  name: workspaceName
  location: location
  properties: {
    sku: {
      name: 'PerGB2018'
    }
    retentionInDays: 30
    features: {
      enableLogAccessUsingOnlyResourcePermissions: true
    }
  }
}

resource environment 'Microsoft.App/managedEnvironments@2024-03-01' = {
  name: environmentName
  location: location
  properties: {
    appLogsConfiguration: {
      destination: 'log-analytics'
      logAnalyticsConfiguration: {
        customerId: workspace.properties.customerId
        sharedKey: workspace.listKeys().primarySharedKey
      }
    }
  }
}

resource containerApps 'Microsoft.App/containerApps@2024-03-01' = [
  for app in apps: {
    name: take('ca-${namePrefix}-${app.name}', 32)
    location: location
    identity: {
      type: 'UserAssigned'
      userAssignedIdentities: {
        '${identityId}': {}
      }
    }
    properties: {
      managedEnvironmentId: environment.id
      configuration: {
        ingress: app.external
          ? {
              external: true
              targetPort: app.targetPort
              transport: 'http'
              allowInsecure: false
            }
          : null
        registries: [
          {
            server: acrLoginServer
            identity: identityId
          }
        ]
        secrets: [
          for secret in app.secrets: {
            name: secret
            keyVaultUrl: '${keyVaultUri}secrets/${secret}'
            identity: identityId
          }
        ]
      }
      template: {
        containers: [
          {
            name: app.name
            image: '${acrLoginServer}/bidstream-${app.name}:${imageTag}'
            resources: {
              cpu: json('0.5')
              memory: '1Gi'
            }
            env: app.env
          }
        ]
        scale: {
          minReplicas: app.minReplicas
          maxReplicas: app.maxReplicas
        }
      }
    }
  }
]

output environmentId string = environment.id
