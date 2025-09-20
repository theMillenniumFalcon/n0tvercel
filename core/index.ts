import 'dotenv/config'
import express, { Request, Response } from 'express'
import { generateSlug } from 'random-word-slugs'
import { ECSClient, RunTaskCommand } from '@aws-sdk/client-ecs'
import { PrismaClient } from '@prisma/client'
import { Server } from 'socket.io'
import Redis from 'ioredis'
import z from 'zod'

const app = express()

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

const subscriber = new Redis(process.env.REDIS_URL || '', {
    maxRetriesPerRequest: 3,
    lazyConnect: true,
    keepAlive: 30000,
    connectTimeout: 10000,
    commandTimeout: 5000,
    enableReadyCheck: false
})

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

async function initRedisSubscribe() {
    console.log('Subscribed to logs....')
    subscriber.psubscribe('logs:*')
    subscriber.on('pmessage', (pattern, channel, message) => {
        io.to(channel).emit('message', message)
    })
}

initRedisSubscribe()

// Graceful shutdown handling
process.on('SIGTERM', gracefulShutdown)
process.on('SIGINT', gracefulShutdown)

async function gracefulShutdown() {
    console.log('Shutting down gracefully...')
    try {
        await subscriber.quit()
        console.log('Redis connection closed')
    } catch (err) {
        console.error('Error closing Redis connection:', err)
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