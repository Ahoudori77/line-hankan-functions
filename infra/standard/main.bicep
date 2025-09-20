// Standard テンプレ v1（FD/WAF は後段で追加）
param env string = 'prod'
param client string
param location string = 'japaneast'
param project string = 'frema'

// ---- 名前規約（サービス毎に一意ルールあり） ----
var nameBase = '${project}-${client}-${env}'
var funcName = 'func-${nameBase}'
var swaName  = 'swa-${nameBase}'
var kvName   = 'kv-${nameBase}'
var cosmosName = 'cosmos-${project}-${client}-${env}' // cosmos は小文字/ハイフンOK
var laName   = 'log-${nameBase}'
var aiName   = 'appi-${nameBase}'

// Storage はグローバル一意 & 小文字のみ → uniqueString で生成
var stgName  = toLower('st${project}${client}${env}${uniqueString(resourceGroup().id)}')

// ---- Log Analytics / App Insights ----
resource la 'Microsoft.OperationalInsights/workspaces@2022-10-01' = {
  name: laName
  location: location
  properties: {
    retentionInDays: 30
    publicNetworkAccessForIngestion: 'Enabled'
    publicNetworkAccessForQuery: 'Enabled'
  }
}

resource ai 'Microsoft.Insights/components@2022-06-15' = {
  name: aiName
  location: location
  kind: 'web'
  properties: {
    ConnectionString: ''
    Flow_Type: 'Bluefield'
    Application_Type: 'web'
    WorkspaceResourceId: la.id
  }
}

// ---- Key Vault（RBACモード）----
resource kv 'Microsoft.KeyVault/vaults@2023-07-01' = {
  name: kvName
  location: location
  properties: {
    tenantId: subscription().tenantId
    sku: { name: 'standard', family: 'A' }
    enableRbacAuthorization: true
    enabledForTemplateDeployment: true
    enableSoftDelete: true
    softDeleteRetentionInDays: 90
    publicNetworkAccess: 'Enabled'
  }
}

// ---- Storage Account（Functions などで使用） ----
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

// ---- Function App Plan（Elastic Premium EP1） ----
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

// ---- Function App（SystemAssigned MI / スロット作成） ----
resource func 'Microsoft.Web/sites@2023-12-01' = {
  name: funcName
  location: location
  kind: 'functionapp'
  identity: {
    type: 'SystemAssigned'
  }
  properties: {
    httpsOnly: true
    serverFarmId: plan.id
    siteConfig: {
      linuxFxVersion: 'Node|20'
      appSettings: [
        { name: 'FUNCTIONS_EXTENSION_VERSION', value: '~4' }
        { name: 'FUNCTIONS_WORKER_RUNTIME', value: 'node' }
        { name: 'WEBSITE_RUN_FROM_PACKAGE', value: '1' }
        // Key Vault 参照は後続の GitHub Actions で SecretUri を注入
      ]
    }
  }
}

// staging スロット
resource slot 'Microsoft.Web/sites/slots@2023-12-01' = {
  name: '${funcName}/staging'
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
  dependsOn: [ func ]
}

// ---- Static Web Apps（Standard） ----
resource swa 'Microsoft.Web/staticSites@2023-12-01' = {
  name: swaName
  location: location
  sku: { name: 'Standard' }
  properties: {
    repositoryUrl: '' // デプロイは Actions で実施
    buildProperties: {}
  }
}

// ---- Cosmos DB（Core(SQL)）& DB/Containers ----
resource cosmos 'Microsoft.DocumentDB/databaseAccounts@2024-05-15' = {
  name: cosmosName
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
    enableFreeTier: false
    publicNetworkAccess: 'Enabled'
    disableKeyBasedMetadataWriteAccess: false
    isVirtualNetworkFilterEnabled: false
    enableAnalyticalStorage: false
    minimalTlsVersion: 'Tls12'
    capabilities: []
  }
}

resource sqlDb 'Microsoft.DocumentDB/databaseAccounts/sqlDatabases@2024-05-15' = {
  name: '${cosmos.name}/frema'
  properties: {
    resource: { id: 'frema' }
    options: { throughput: 0 } // Autoscale はコンテナ側で
  }
}

resource cUsers 'Microsoft.DocumentDB/databaseAccounts/sqlDatabases/containers@2024-05-15' = {
  name: '${cosmos.name}/frema/Users'
  properties: {
    resource: {
      id: 'Users'
      partitionKey: { paths: ['/tenantId'], kind: 'Hash' }
    }
    options: { autoscaleSettings: { maxThroughput: 1000 } }
  }
}

resource cItems 'Microsoft.DocumentDB/databaseAccounts/sqlDatabases/containers@2024-05-15' = {
  name: '${cosmos.name}/frema/Items'
  properties: {
    resource: {
      id: 'Items'
      partitionKey: { paths: ['/tenantId'], kind: 'Hash' }
    }
    options: { autoscaleSettings: { maxThroughput: 1000 } }
  }
}

resource cInventory 'Microsoft.DocumentDB/databaseAccounts/sqlDatabases/containers@2024-05-15' = {
  name: '${cosmos.name}/frema/Inventory'
  properties: {
    resource: {
      id: 'Inventory'
      partitionKey: { paths: ['/tenantId'], kind: 'Hash' }
    }
    options: { autoscaleSettings: { maxThroughput: 1000 } }
  }
}

resource cOrders 'Microsoft.DocumentDB/databaseAccounts/sqlDatabases/containers@2024-05-15' = {
  name: '${cosmos.name}/frema/Orders'
  properties: {
    resource: {
      id: 'Orders'
      partitionKey: { paths: ['/tenantId'], kind: 'Hash' }
      uniqueKeyPolicy: {
        uniqueKeys: [ { paths: ['/eventId'] } ]
      }
    }
    options: { autoscaleSettings: { maxThroughput: 2000 } }
  }
}

// ---- 出力（GitHub Actions で使用） ----
output kvName string = kv.name
output stgName string = stg.name
output funcName string = func.name
output funcPrincipalId string = func.identity.principalId
output swaName string = swa.name
output cosmosName string = cosmos.name
output aiConnectionString string = ai.properties.ConnectionString
