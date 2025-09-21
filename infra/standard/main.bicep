targetScope = 'resourceGroup'

param env string = 'prod'
param client string
param location string = 'japaneast'
param project string = 'frema'
param swaLocation string = 'eastasia' // SWA は対応リージョンを使う
param enableMonitoring bool = false

// ---- Names ----
var nameBase = '${project}-${client}-${env}'
var suffix   = toLower(uniqueString(resourceGroup().id))

var funcName = 'func-${nameBase}-${suffix}'
var swaName  = 'swa-${nameBase}-${suffix}'
var kvName   = 'kv-${nameBase}-${suffix}'
var cosmosAccountName = toLower('cos${project}${client}${env}${suffix}')
var stgName  = toLower('st${project}${client}${env}${uniqueString(resourceGroup().id)}')

// ---- Log Analytics / App Insights ----
resource la 'Microsoft.OperationalInsights/workspaces@2022-10-01' = if (enableMonitoring) {
  name: 'log-${nameBase}-${suffix}'
  location: location
  properties: {
    retentionInDays: 30
    publicNetworkAccessForIngestion: 'Enabled'
    publicNetworkAccessForQuery: 'Enabled'
  }
}

resource ai 'Microsoft.Insights/components@2022-06-15' = if (enableMonitoring) {
  name: 'appi-${nameBase}-${suffix}'
  location: location
  kind: 'web'
  properties: {
    Flow_Type: 'Bluefield'
    Application_Type: 'web'
    WorkspaceResourceId: la.id
  }
}

// ---- Key Vault (RBAC) ----
resource kv 'Microsoft.KeyVault/vaults@2023-07-01' = {
  name: kvName
  location: location
  properties: {
    tenantId: subscription().tenantId
    sku: { name: 'standard', family: 'A' }
    enableRbacAuthorization: true
    softDeleteRetentionInDays: 90
    publicNetworkAccess: 'Enabled'
  }
}

// ---- Storage ----
resource stg 'Microsoft.Storage/storageAccounts@2023-01-01' = {
  name: stgName
  location: location
  sku: { name: 'Standard_LRS' }
  kind: 'StorageV2'
  properties: {
    allowBlobPublicAccess: false
    minimumTlsVersion: 'TLS1_2'
    supportsHttpsTrafficOnly: true
  }
}

// ---- Function App Plan (EP1 Linux) ----
resource plan 'Microsoft.Web/serverfarms@2023-12-01' = {
  name: 'plan-${nameBase}'
  location: location
  sku: {
    name: 'EP1'
    tier: 'ElasticPremium'
    size: 'EP1'
    capacity: 1
  }
  kind: 'elastic'
  properties: {
    maximumElasticWorkerCount: 20
    reserved: true
  }
}

// ---- Function App + staging slot ----
resource func 'Microsoft.Web/sites@2023-12-01' = {
  name: funcName
  location: location
  kind: 'functionapp'
  identity: { type: 'SystemAssigned' }
  properties: {
    httpsOnly: true
    serverFarmId: plan.id
    siteConfig: {
      linuxFxVersion: 'Node|20'
      appSettings: [
        { name: 'FUNCTIONS_EXTENSION_VERSION', value: '~4' }
        { name: 'FUNCTIONS_WORKER_RUNTIME', value: 'node' }
        { name: 'WEBSITE_RUN_FROM_PACKAGE', value: '1' }
      ]
    }
  }
}

resource slot 'Microsoft.Web/sites/slots@2023-12-01' = {
  name: 'staging'
  parent: func
  properties: {
    siteConfig: {
      linuxFxVersion: 'Node|20'
      appSettings: [
        { name: 'FUNCTIONS_EXTENSION_VERSION', value: '~4' }
        { name: 'FUNCTIONS_WORKER_RUNTIME', value: 'node' }
        { name: 'WEBSITE_RUN_FROM_PACKAGE', value: '1' }
      ]
    }
  }
}

// ---- Static Web Apps ----
resource swa 'Microsoft.Web/staticSites@2023-12-01' = {
  name: swaName
  location: swaLocation
  sku: {
    name: 'Standard'
    tier: 'Standard'
  }
  properties: {}
}

// ---- Cosmos DB (account -> db -> containers) ----
resource cosmos 'Microsoft.DocumentDB/databaseAccounts@2024-05-15' = {
  name: cosmosAccountName
  location: location
  kind: 'GlobalDocumentDB'
  properties: {
    databaseAccountOfferType: 'Standard'
    locations: [
      {
        locationName: location
        failoverPriority: 0
        isZoneRedundant: false
      }
    ]
    publicNetworkAccess: 'Enabled'
    minimalTlsVersion: 'Tls12'
  }
}

resource sqlDb 'Microsoft.DocumentDB/databaseAccounts/sqlDatabases@2024-05-15' = {
  name: 'frema'
  parent: cosmos
  properties: {
    resource: { id: 'frema' }
  }
}

resource cUsers 'Microsoft.DocumentDB/databaseAccounts/sqlDatabases/containers@2024-05-15' = {
  name: 'Users'
  parent: sqlDb
  properties: {
    resource: {
      id: 'Users'
      partitionKey: { paths: ['/tenantId'], kind: 'Hash' }
    }
    options: { autoscaleSettings: { maxThroughput: 1000 } }
  }
}

resource cItems 'Microsoft.DocumentDB/databaseAccounts/sqlDatabases/containers@2024-05-15' = {
  name: 'Items'
  parent: sqlDb
  properties: {
    resource: {
      id: 'Items'
      partitionKey: { paths: ['/tenantId'], kind: 'Hash' }
    }
    options: { autoscaleSettings: { maxThroughput: 1000 } }
  }
}

resource cInventory 'Microsoft.DocumentDB/databaseAccounts/sqlDatabases/containers@2024-05-15' = {
  name: 'Inventory'
  parent: sqlDb
  properties: {
    resource: {
      id: 'Inventory'
      partitionKey: { paths: ['/tenantId'], kind: 'Hash' }
    }
    options: { autoscaleSettings: { maxThroughput: 1000 } }
  }
}

resource cOrders 'Microsoft.DocumentDB/databaseAccounts/sqlDatabases/containers@2024-05-15' = {
  name: 'Orders'
  parent: sqlDb
  properties: {
    resource: {
      id: 'Orders'
      partitionKey: { paths: ['/tenantId'], kind: 'Hash' }
      uniqueKeyPolicy: { uniqueKeys: [ { paths: ['/eventId'] } ] }
    }
    options: { autoscaleSettings: { maxThroughput: 2000 } }
  }
}

// ---- Outputs ----
output kvName string = kv.name
output stgName string = stg.name
output funcName string = func.name
output funcPrincipalId string = func.identity.principalId
output swaName string = swa.name
output cosmosName string = cosmos.name
