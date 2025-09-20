import { Kafka } from 'kafkajs'
import { v4 as uuidv4 } from 'uuid'
import * as fs from 'fs'
import path from 'path'
import { KAFKA_CONFIG } from '../config/constants'
import { getEnvironmentConfig } from '../config/environment'
import { clickhouseClient } from './database'
import { KafkaMessage } from '../types/kafka'
import { LogEntry } from '../types/api'

const env = getEnvironmentConfig()

const kafka = new Kafka({
    clientId: 'api-server',
    brokers: [env.KAFKA_BROKER],
    ssl: {
        ca: [fs.readFileSync(path.join(__dirname, '../../kafka.pem'), 'utf-8')]
    },
    sasl: {
        username: env.KAFKA_SASL_USERNAME,
        password: env.KAFKA_SASL_PASSWORD,
        mechanism: KAFKA_CONFIG.SASL_MECHANISM
    }
})

export const consumer = kafka.consumer({ groupId: 'core-logs-consumer' })

export const initKafkaConsumer = async (): Promise<void> => {
    try {
        console.log('Connecting to Kafka...')
        await consumer.connect()
        console.log('Kafka consumer connected successfully')
        
        await consumer.subscribe({ topics: ['container-logs'], fromBeginning: true })
        console.log('Subscribed to container-logs topic')

        await consumer.run({
            eachBatch: async function ({ batch, heartbeat, commitOffsetsIfNecessary, resolveOffset }) {
                try {
                    const messages = batch.messages;
                    console.log(`Received ${messages.length} messages from topic: ${batch.topic}`)
                    
                    const validMessages = messages.filter(msg => msg.value)
                    if (validMessages.length === 0) {
                        console.log('No valid messages in batch, skipping')
                        return;
                    }
                    
                    const logEntries: LogEntry[] = [];
                    
                    for (const message of validMessages) {
                        try {
                            const stringMessage = message.value!.toString()
                            const parsedMessage: KafkaMessage = JSON.parse(stringMessage)
                            
                            // Validate required fields
                            if (!parsedMessage.DEPLOYEMENT_ID || !parsedMessage.log) {
                                console.warn('Invalid message format, skipping:', parsedMessage)
                                resolveOffset(message.offset)
                                continue;
                            }
                            
                            logEntries.push({
                                event_id: uuidv4(),
                                deployment_id: parsedMessage.DEPLOYEMENT_ID,
                                log: parsedMessage.log,
                                timestamp: new Date().toISOString()
                            })
                            
                            resolveOffset(message.offset)
                        } catch (parseError) {
                            console.error('Error parsing message:', parseError, 'Message:', message.value?.toString())
                            resolveOffset(message.offset) // Skip this message
                        }
                    }
                    
                    // Batch insert to ClickHouse
                    if (logEntries.length > 0) {
                        try {
                            const { query_id } = await clickhouseClient.insert({
                                table: 'log_events',
                                values: logEntries,
                                format: 'JSONEachRow'
                            })
                            console.log(`Successfully inserted ${logEntries.length} log entries. Query ID: ${query_id}`)
                        } catch (insertError) {
                            console.error('Error inserting logs to ClickHouse:', insertError)
                            // Don't commit offsets if insertion failed
                            return;
                        }
                    }
                    
                    // Commit offsets and heartbeat only after successful processing
                    await commitOffsetsIfNecessary()
                    await heartbeat()
                    
                } catch (batchError) {
                    console.error('Error processing batch:', batchError)
                    // Send heartbeat to prevent consumer from being kicked out
                    try {
                        await heartbeat()
                    } catch (heartbeatError) {
                        console.error('Error sending heartbeat:', heartbeatError)
                    }
                }
            }
        })
        
        console.log('Kafka consumer started successfully')
        
    } catch (error) {
        console.error('Failed to initialize Kafka consumer:', error)
        // Attempt to disconnect on error
        try {
            await consumer.disconnect()
        } catch (disconnectError) {
            console.error('Error disconnecting consumer after failure:', disconnectError)
        }
        throw error;
    }
}

export const disconnectKafkaConsumer = async (): Promise<void> => {
    try {
        await consumer.disconnect()
        console.log('Kafka consumer connection closed')
    } catch (err) {
        console.error('Error closing Kafka consumer connection:', err)
    }
}
