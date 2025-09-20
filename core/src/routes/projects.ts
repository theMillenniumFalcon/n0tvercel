import { Router, Request, Response } from 'express'
import { generateSlug } from 'random-word-slugs'
import z from 'zod'
import { prisma } from '../services/database'
import { asyncHandler } from '../middleware'
import { CreateProjectRequest, CreateProjectResponse } from '../types'

const router = Router()

router.post('/project', asyncHandler(async (req: Request, res: Response) => {
    const schema = z.object({
        name: z.string(),
        gitURL: z.string()
    })
    const safeParseResult = schema.safeParse(req.body)

    if (safeParseResult.error) return res.status(400).json({ error: safeParseResult.error })

    const { name, gitURL }: CreateProjectRequest = safeParseResult.data

    const project = await prisma.project.create({
        data: {
            name,
            gitURL,
            subDomain: generateSlug()
        }
    })

    const response: CreateProjectResponse = { project }
    return res.json({ status: 'success', data: response })
}))

export default router
