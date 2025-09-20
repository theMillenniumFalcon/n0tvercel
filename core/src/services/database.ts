import { PrismaClient } from '@prisma/client'
import { createClient } from '@clickhouse/client'
import { getEnvironmentConfig } from '../config/environment'

const env = getEnvironmentConfig()

export const prisma = new PrismaClient({
    datasources: {
        db: {
            url: env.DATABASE_URL
        }
    },
    log: ['error', 'warn'],
    errorFormat: 'pretty'
})

export const clickhouseClient = createClient({
    host: env.CLICKHOUSE_HOST,
    database: env.CLICKHOUSE_DATABASE,
    username: env.CLICKHOUSE_USERNAME,
    password: env.CLICKHOUSE_PASSWORD
})

export const closeDatabaseConnections = async () => {
    try {
        await clickhouseClient.close()
        console.log('ClickHouse connection closed')
    } catch (err) {
        console.error('Error closing ClickHouse connection:', err)
    }
    
    try {
        await prisma.$disconnect()
        console.log('Prisma connection closed')
    } catch (err) {
        console.error('Error closing Prisma connection:', err)
    }
}
