import 'dotenv/config'
import express from 'express'
import { SERVER_CONFIG } from './config/constants'
import { getEnvironmentConfig } from './config/environment'
import { errorHandler } from './middleware'
import { initKafkaConsumer } from './services/kafka'
import { setupGracefulShutdown } from './utils/gracefulShutdown'
import apiRoutes from './routes'

const env = getEnvironmentConfig()

const createApp = (): express.Application => {
    const app = express()

    // Middleware
    app.use(express.json({ limit: SERVER_CONFIG.JSON_LIMIT }))
    app.use(express.urlencoded({ extended: true, limit: SERVER_CONFIG.URL_ENCODED_LIMIT }))

    // Routes
    app.use(apiRoutes)

    // Error handling middleware (must be last)
    app.use(errorHandler)

    return app
}

const startServer = async (): Promise<void> => {
    const app = createApp()
    
    // Setup graceful shutdown
    setupGracefulShutdown()

    // Initialize Kafka consumer
    try {
        await initKafkaConsumer()
    } catch (error) {
        console.error('Failed to start Kafka consumer:', error)
        process.exit(1)
    }

    // Start HTTP server
    app.listen(env.PORT, () => {
        console.log(`API Server Running on port ${env.PORT}`)
    })
}

// Start the server
startServer().catch((error) => {
    console.error('Failed to start server:', error)
    process.exit(1)
})
