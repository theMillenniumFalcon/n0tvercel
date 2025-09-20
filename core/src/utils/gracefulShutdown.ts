import { disconnectKafkaConsumer } from '../services/kafka'
import { closeDatabaseConnections } from '../services/database'

export const gracefulShutdown = async (): Promise<void> => {
    console.log('Shutting down gracefully...')
    
    try {
        await disconnectKafkaConsumer()
    } catch (err) {
        console.error('Error during graceful shutdown:', err)
    }
    
    try {
        await closeDatabaseConnections()
    } catch (err) {
        console.error('Error during graceful shutdown:', err)
    }
    
    process.exit(0)
}

export const setupGracefulShutdown = (): void => {
    process.on('SIGTERM', gracefulShutdown)
    process.on('SIGINT', gracefulShutdown)
}
