// Standard テンプレ v1（FD/WAF は後段で追加）
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
