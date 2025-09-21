// CLEAN v1.2 (ASCII only)
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
publicNetworkAccess: 'Enabled'
minimalTlsVersion: 'Tls12'
}
}


resource sqlDb 'Microsoft.DocumentDB/databaseAccounts/sqlDatabases@2024-05-15' = {
name: '${cosmos.name}/frema'
properties: {
resource: { id: 'frema' }
options: { throughput: 0 }
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


output kvName string = kv.name
output stgName string = stg.name
output funcName string = func.name
output funcPrincipalId string = func.identity.principalId
output swaName string = swa.name
output cosmosName string = cosmos.name
