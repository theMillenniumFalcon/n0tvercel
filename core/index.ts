import 'dotenv/config'
import express, { Request, Response } from 'express'
import { generateSlug } from 'random-word-slugs'
import { ECSClient, RunTaskCommand } from '@aws-sdk/client-ecs'
import { Server } from 'socket.io'
import Redis from 'ioredis'

const app = express()

app.use(express.json({ limit: '1mb' }))
app.use(express.urlencoded({ extended: true, limit: '1mb' }))
const PORT: number = Number(process.env.PORT ?? 9000)

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

app.post('/project', async (req: Request, res: Response) => {
	const { gitURL, slug }: { gitURL?: string; slug?: string } = req.body || {}
	if (!gitURL || typeof gitURL !== 'string') {
		return res.status(400).json({ error: 'gitURL is required' })
	}

	const projectSlug: string = slug && typeof slug === 'string' ? slug : generateSlug()

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
                        { name: 'GIT_REPOSITORY__URL', value: gitURL },
                        { name: 'PROJECT_ID', value: projectSlug }
                    ]
                }
            ]
        }
    })

	// Respond immediately and run ECS call in background
	res.status(202).json({
		status: 'queued',
		data: { projectSlug, url: `http://${projectSlug}.localhost:8000` }
	})

    ecsClient.send(command)
        .then(result => {
            console.log('ECS task started successfully:', result.tasks?.[0]?.taskArn)
        })
        .catch((err) => {
            console.error('RunTask failed', { err, gitURL, projectSlug })
            // Consider implementing retry logic or dead letter queue
        })
})

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
    process.exit(0)
}

app.listen(PORT, () => console.log(`API Server Running..${PORT}`))