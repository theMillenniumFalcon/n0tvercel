import 'dotenv/config'
import express, { Request, Response } from 'express'
import { generateSlug } from 'random-word-slugs'
import { ECSClient, RunTaskCommand } from '@aws-sdk/client-ecs'
import { PrismaClient } from '@prisma/client'
import { createClient } from '@clickhouse/client'
import { Kafka } from 'kafkajs'
import { Server } from 'socket.io'
import { v4 as uuidv4 } from 'uuid'
import z from 'zod'
import * as fs from 'fs'
import path from 'path'

const app = express()

// constants
const KAFKA_CONFIG = {
    SASL_MECHANISM: 'plain' as const
} as const

app.use(express.json({ limit: '1mb' }))
app.use(express.urlencoded({ extended: true, limit: '1mb' }))

// Error handling middleware
app.use((err: Error, req: Request, res: Response, next: any) => {
    console.error('Unhandled error:', err)
    
    if (err.name === 'ValidationError') {
        return res.status(400).json({
            error: 'Validation failed',
            message: err.message
        })
    }
    
    if (err.name === 'PrismaClientKnownRequestError') {
        return res.status(400).json({
            error: 'Database error',
            message: 'Invalid request to database'
        })
    }
    
    if (err.name === 'PrismaClientUnknownRequestError') {
        return res.status(500).json({
            error: 'Database error',
            message: 'Unknown database error occurred'
        })
    }
    
    res.status(500).json({
        error: 'Internal server error',
        message: process.env.NODE_ENV === 'development' ? err.message : 'Something went wrong'
    })
})

// Async error wrapper
const asyncHandler = (fn: Function) => (req: Request, res: Response, next: any) => {
    Promise.resolve(fn(req, res, next)).catch(next)
}

const PORT: number = Number(process.env.PORT ?? 9000)

const prisma = new PrismaClient({
    datasources: {
        db: {
            url: process.env.DATABASE_URL
        }
    },
    log: ['error', 'warn'],
    errorFormat: 'pretty'
})

const kafka = new Kafka({
    clientId: 'api-server',
    brokers: [process.env.KAFKA_BROKER as string],
    ssl: {
        ca: [fs.readFileSync(path.join(__dirname, 'kafka.pem'), 'utf-8')]
    },
    sasl: {
        username: process.env.KAFKA_SASL_USERNAME as string,
        password: process.env.KAFKA_SASL_PASSWORD as string,
        mechanism: KAFKA_CONFIG.SASL_MECHANISM
    }
})

const client = createClient({
    host: process.env.CLICKHOUSE_HOST,
    database: process.env.CLICKHOUSE_DATABASE,
    username: process.env.CLICKHOUSE_USERNAME,
    password: process.env.CLICKHOUSE_PASSWORD || ''
})

const consumer = kafka.consumer({ groupId: 'core-logs-consumer' })

const io = new Server({ 
    cors: { 
        origin: process.env.ALLOWED_ORIGINS?.split(',') || ['http://localhost:3000'],
        credentials: true 
    },
    maxHttpBufferSize: 1e6,
    pingTimeout: 60000,
    pingInterval: 25000,
    transports: ['websocket', 'polling']
})

io.on('connection', socket => {
    socket.on('subscribe', channel => {
        socket.join(channel)
        socket.emit('message', `Joined ${channel}`)
    })
})

io.listen(9002)
console.log('Socket Server 9002')

const ecsClient = new ECSClient({
    region: process.env.AWS_REGION || '',
    credentials: {
        accessKeyId: process.env.AWS_ACCESS_KEY_ID || '',
        secretAccessKey: process.env.AWS_SECRET_ACCESS_KEY || ''
    },
    maxAttempts: 5,
    requestHandler: {
        requestTimeout: 30000,
        connectionTimeout: 10000
    }
})

const config = {
    CLUSTER: process.env.ECS_CLUSTER || '',
    TASK: process.env.ECS_TASK_DEFINITION || '',
    SUBNETS: (process.env.ECS_SUBNETS || '').split(',').filter(Boolean),
    SECURITY_GROUPS: (process.env.ECS_SECURITY_GROUPS || '').split(',').filter(Boolean)
}

app.post('/project', asyncHandler(async (req: Request, res: Response) => {
    const schema = z.object({
        name: z.string(),
        gitURL: z.string()
    })
    const safeParseResult = schema.safeParse(req.body)

    if (safeParseResult.error) return res.status(400).json({ error: safeParseResult.error })

    const { name, gitURL } = safeParseResult.data

    const project = await prisma.project.create({
        data: {
            name,
            gitURL,
            subDomain: generateSlug()
        }
    })

    return res.json({ status: 'success', data: { project } })
}))

app.post('/deploy', asyncHandler(async (req: Request, res: Response) => {
    const deploySchema = z.object({
        projectId: z.string().uuid('Invalid project ID format')
    })
    
    const safeParseResult = deploySchema.safeParse(req.body)
    
    if (safeParseResult.error) {
        return res.status(400).json({ 
            error: 'Validation failed', 
            details: safeParseResult.error.issues 
        })
    }
    
    const { projectId } = safeParseResult.data

    const project = await prisma.project.findUnique({ where: { id: projectId } })

    if (!project) return res.status(404).json({ error: 'Project not found' })

    // Check if there is no running deployment
    const deployment = await prisma.deployment.create({
        data: {
            project: { connect: { id: projectId } },
            status: 'QUEUED',
        }
    })

    // Prepare ECS task run
    const command = new RunTaskCommand({
        cluster: config.CLUSTER,
        taskDefinition: config.TASK,
        launchType: 'FARGATE',
        count: 1,
        networkConfiguration: {
            awsvpcConfiguration: {
                assignPublicIp: 'ENABLED',
                subnets: config.SUBNETS.length ? config.SUBNETS : ['', '', ''],
                securityGroups: config.SECURITY_GROUPS.length ? config.SECURITY_GROUPS : ['']
            }
        },
        overrides: {
            containerOverrides: [
                {
                    name: 'craft',
                    environment: [
                        { name: 'GIT_REPOSITORY__URL', value: project.gitURL },
                        { name: 'PROJECT_ID', value: projectId },
                        { name: 'DEPLOYEMENT_ID', value: deployment.id },
                    ]
                }
            ]
        }
    })

	// Respond immediately and run ECS call in background
	res.status(202).json({
		status: 'queued',
		data: { deploymentId: deployment.id }
	})

    ecsClient.send(command)
        .then(result => {
            console.log('ECS task started successfully:', result.tasks?.[0]?.taskArn)
        })
        .catch((err) => {
            console.error('RunTask failed', { err, projectId, deployment })
            // Consider implementing retry logic or dead letter queue
        })
}))

async function initKafkaConsumer() {
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
                    
                    const logEntries = [];
                    
                    for (const message of validMessages) {
                        try {
                            const stringMessage = message.value!.toString()
                            const parsedMessage = JSON.parse(stringMessage)
                            
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
                            const { query_id } = await client.insert({
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

// Initialize Kafka consumer with error handling
initKafkaConsumer().catch(error => {
    console.error('Failed to start Kafka consumer:', error)
    // In production, you might want to restart the process or implement retry logic
    process.exit(1)
})

// Graceful shutdown handling
process.on('SIGTERM', gracefulShutdown)
process.on('SIGINT', gracefulShutdown)

async function gracefulShutdown() {
    console.log('Shutting down gracefully...')
    
    try {
        await consumer.disconnect()
        console.log('Kafka consumer connection closed')
    } catch (err) {
        console.error('Error closing Kafka consumer connection:', err)
    }
    
    try {
        await client.close()
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
    
    process.exit(0)
}

app.listen(PORT, () => console.log(`API Server Running..${PORT}`))