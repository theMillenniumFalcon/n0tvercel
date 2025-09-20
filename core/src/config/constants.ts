export const KAFKA_CONFIG = {
    SASL_MECHANISM: 'plain' as const
} as const

export const SERVER_CONFIG = {
    DEFAULT_PORT: 9000,
    JSON_LIMIT: '1mb',
    URL_ENCODED_LIMIT: '1mb'
} as const

export const AWS_CONFIG = {
    MAX_ATTEMPTS: 5,
    REQUEST_TIMEOUT: 30000,
    CONNECTION_TIMEOUT: 10000
} as const
