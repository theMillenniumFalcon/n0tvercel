export const getEnvironmentConfig = () => ({
    // Server
    PORT: Number(process.env.PORT ?? 9000),
    NODE_ENV: process.env.NODE_ENV || 'development',
    
    // Database
    DATABASE_URL: process.env.DATABASE_URL,
    
    // Kafka
    KAFKA_BROKER: process.env.KAFKA_BROKER as string,
    KAFKA_SASL_USERNAME: process.env.KAFKA_SASL_USERNAME as string,
    KAFKA_SASL_PASSWORD: process.env.KAFKA_SASL_PASSWORD as string,
    
    // ClickHouse
    CLICKHOUSE_HOST: process.env.CLICKHOUSE_HOST,
    CLICKHOUSE_DATABASE: process.env.CLICKHOUSE_DATABASE,
    CLICKHOUSE_USERNAME: process.env.CLICKHOUSE_USERNAME,
    CLICKHOUSE_PASSWORD: process.env.CLICKHOUSE_PASSWORD,
    
    // AWS
    AWS_REGION: process.env.AWS_REGION || '',
    AWS_ACCESS_KEY_ID: process.env.AWS_ACCESS_KEY_ID || '',
    AWS_SECRET_ACCESS_KEY: process.env.AWS_SECRET_ACCESS_KEY || '',
    
    // ECS
    ECS_CLUSTER: process.env.ECS_CLUSTER || '',
    ECS_TASK_DEFINITION: process.env.ECS_TASK_DEFINITION || '',
    ECS_SUBNETS: (process.env.ECS_SUBNETS || '').split(',').filter(Boolean),
    ECS_SECURITY_GROUPS: (process.env.ECS_SECURITY_GROUPS || '').split(',').filter(Boolean)
})
