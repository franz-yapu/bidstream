// Event Hubs con endpoint compatible con Kafka (spec §4 y §9).
// Un hub es un topic de Kafka: el nombre del hub ES el nombre del topic. No hay compactación y la
// retención máxima depende del SKU (7 días en Standard, 90 en Premium); por eso es parametrizable.

@description('Nombre del namespace de Event Hubs.')
param namespaceName string

@description('Región de Azure.')
param location string

@allowed(['Standard', 'Premium'])
@description('SKU del namespace. Kafka requiere Standard o superior.')
param sku string = 'Standard'

@minValue(1)
@description('Unidades de throughput (o unidades de procesamiento en Premium).')
param capacity int = 1

@minValue(1)
@maxValue(90)
@description('Retención de events.lot en días (7 en Standard, hasta 90 en Premium).')
param eventsRetentionDays int = 7

@minValue(1)
@maxValue(90)
@description('Retención del DLQ en días (7 en Standard, hasta 90 en Premium).')
param dlqRetentionDays int = 7

@description('Regla de autorización de las aplicaciones (Send+Listen, sin Manage).')
param appRuleName string = 'bidstream-app'

// La spec pide 6 particiones para los topics de lotes y 1 para el DLQ. Los grupos son los reales del
// código: los tres consumidores de la spec, el decisor (C3), su estado y el reproceso (D7).
var hubs = [
  {
    name: 'bidstream.commands.bid'
    partitions: 6
    retentionDays: eventsRetentionDays
  }
  {
    name: 'bidstream.events.lot'
    partitions: 6
    retentionDays: eventsRetentionDays
  }
  {
    name: 'bidstream.events.lot.dlq'
    partitions: 1
    retentionDays: dlqRetentionDays
  }
]

var consumerGroups = [
  { hub: 'bidstream.commands.bid', group: 'decider' }
  { hub: 'bidstream.events.lot', group: 'projector' }
  { hub: 'bidstream.events.lot', group: 'notifier' }
  { hub: 'bidstream.events.lot', group: 'auditor' }
  { hub: 'bidstream.events.lot', group: 'decider-state' }
  { hub: 'bidstream.events.lot.dlq', group: 'dlq-reprocessor' }
]

resource namespace 'Microsoft.EventHub/namespaces@2024-01-01' = {
  name: namespaceName
  location: location
  sku: {
    name: sku
    tier: sku
    capacity: capacity
  }
  properties: {
    minimumTlsVersion: '1.2'
    publicNetworkAccess: 'Enabled'
    // Las aplicaciones usan SAS (cadena de conexión). Para deshabilitarla haría falta identidad
    // administrada en el cliente de Kafka, que no está implementada.
    disableLocalAuth: false
  }
}

resource appRule 'Microsoft.EventHub/namespaces/authorizationRules@2024-01-01' = {
  parent: namespace
  name: appRuleName
  properties: {
    rights: [
      'Send'
      'Listen'
    ]
  }
}

resource eventHubs 'Microsoft.EventHub/namespaces/eventhubs@2024-01-01' = [
  for hub in hubs: {
    parent: namespace
    name: hub.name
    properties: {
      partitionCount: hub.partitions
      retentionDescription: {
        cleanupPolicy: 'Delete'
        retentionTimeInHours: hub.retentionDays * 24
      }
    }
  }
]

// Nombre completo (`namespace/hub/grupo`) para recorrer hubs y grupos en un solo bucle.
resource eventHubsConsumerGroups 'Microsoft.EventHub/namespaces/eventhubs/consumergroups@2024-01-01' = [
  for item in consumerGroups: {
    name: '${namespaceName}/${item.hub}/${item.group}'
    properties: {}
    dependsOn: [eventHubs]
  }
]

output namespaceHost string = '${namespace.name}.servicebus.windows.net:9093'
output ruleName string = appRule.name
