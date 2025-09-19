import 'dotenv/config'
import express, { Request, Response } from 'express'
import { generateSlug } from 'random-word-slugs'
import { ECSClient, RunTaskCommand } from '@aws-sdk/client-ecs'

const app = express()
const PORT: number = Number(process.env.PORT ?? 9000)

const ecsClient = new ECSClient({
    region: process.env.AWS_REGION || '',
    credentials: {
        accessKeyId: process.env.AWS_ACCESS_KEY_ID || '',
        secretAccessKey: process.env.AWS_SECRET_ACCESS_KEY || ''
    },
    maxAttempts: 2
})

const config = {
    CLUSTER: process.env.ECS_CLUSTER || '',
    TASK: process.env.ECS_TASK_DEFINITION || '',
    SUBNETS: (process.env.ECS_SUBNETS || '').split(',').filter(Boolean),
    SECURITY_GROUPS: (process.env.ECS_SECURITY_GROUPS || '').split(',').filter(Boolean)
}

app.post('/project', express.json({ limit: '256kb' }), async (req: Request, res: Response) => {
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

    ecsClient.send(command).catch((err) => {
        console.error('RunTask failed', { err })
    })
})

app.listen(PORT, () => console.log(`API Server Running..${PORT}`))