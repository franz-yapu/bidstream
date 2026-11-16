// PostgreSQL Flexible Server (spec §6 y §9). Para la demo se usa red pública con el firewall de
// servicios de Azure y TLS obligatorio; Private Endpoints quedan como evolución de producción.

@description('Nombre del servidor Flexible.')
param serverName string

@description('Región de Azure.')
param location string

@description('Usuario administrador.')
param adminLogin string

@secure()
@description('Contraseña del administrador; llega por parámetro seguro y nunca se registra.')
param adminPassword string

@description('Nombre de la base de datos de la aplicación.')
param databaseName string = 'bidstream'

@description('SKU (Burstable B1ms es el más barato para la demo).')
param skuName string = 'Standard_B1ms'

@minValue(32)
@maxValue(1024)
@description('Almacenamiento en GB.')
param storageSizeGB int = 32

@minValue(1)
@maxValue(35)
@description('Días de backup.')
param backupRetentionDays int = 7

resource server 'Microsoft.DBforPostgreSQL/flexibleServers@2024-08-01' = {
  name: serverName
  location: location
  sku: {
    name: skuName
    tier: 'Burstable'
  }
  properties: {
    version: '16'
    administratorLogin: adminLogin
    administratorLoginPassword: adminPassword
    storage: {
      storageSizeGB: storageSizeGB
      autoGrow: 'Enabled'
    }
    backup: {
      backupRetentionDays: backupRetentionDays
      geoRedundantBackup: 'Disabled'
    }
    highAvailability: {
      mode: 'Disabled'
    }
    network: {
      publicNetworkAccess: 'Enabled'
    }
  }
}

resource database 'Microsoft.DBforPostgreSQL/flexibleServers/databases@2024-08-01' = {
  parent: server
  name: databaseName
  properties: {
    charset: 'UTF8'
    collation: 'en_US.utf8'
  }
}

// TLS en todo (OWASP A02): el cliente debe negociar TLS aunque la red sea pública.
resource requireTls 'Microsoft.DBforPostgreSQL/flexibleServers/configurations@2024-08-01' = {
  parent: server
  name: 'require_secure_transport'
  properties: {
    value: 'ON'
    source: 'user-override'
  }
}

// 0.0.0.0 permite únicamente servicios de Azure (Container Apps), no Internet abierto.
resource allowAzureServices 'Microsoft.DBforPostgreSQL/flexibleServers/firewallRules@2024-08-01' = {
  parent: server
  name: 'AllowAzureServices'
  properties: {
    startIpAddress: '0.0.0.0'
    endIpAddress: '0.0.0.0'
  }
}

output host string = server.properties.fullyQualifiedDomainName
output databaseName string = database.name
