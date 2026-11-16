// Azure Container Registry (spec §9). Sin usuario administrador: las Container Apps se autentican con
// su identidad administrada y el rol AcrPull que asigna main.bicep.

@description('Nombre del registro (solo alfanumérico, 5-50 caracteres).')
param registryName string

@description('Región de Azure.')
param location string

@allowed(['Basic', 'Standard', 'Premium'])
@description('SKU del registro.')
param sku string = 'Basic'

resource registry 'Microsoft.ContainerRegistry/registries@2023-07-01' = {
  name: registryName
  location: location
  sku: {
    name: sku
  }
  properties: {
    adminUserEnabled: false
    publicNetworkAccess: 'Enabled'
    networkRuleBypassOptions: 'AzureServices'
  }
}

output loginServer string = registry.properties.loginServer
output resourceId string = registry.id
