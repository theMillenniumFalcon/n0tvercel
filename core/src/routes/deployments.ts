import { Router, Request, Response } from 'express'
import z from 'zod'
import { prisma } from '../services/database'
import { createECSClient, createECSConfig, runDeploymentTask } from '../services/aws-ecs'
import { asyncHandler } from '../middleware'
import { DeployRequest, DeployResponse } from '../types'

const router = Router()

router.post('/deploy', asyncHandler(async (req: Request, res: Response) => {
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
    
    const { projectId }: DeployRequest = safeParseResult.data

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
    const ecsClient = createECSClient()
    const config = createECSConfig()

	// Respond immediately and run ECS call in background
	const response: DeployResponse = { deploymentId: deployment.id }
	res.status(202).json({
		status: 'queued',
		data: response
	})

    // Run ECS task in background
    runDeploymentTask(ecsClient, config, project.gitURL, projectId, deployment.id)
        .then(result => {
            console.log('Deployment task completed successfully')
        })
        .catch((err) => {
            console.error('Deployment task failed', { err, projectId, deployment })
            // Consider implementing retry logic or dead letter queue
        })
}))

export default router
