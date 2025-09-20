import { Router, Request, Response } from 'express'
import z from 'zod'
import { clickhouseClient } from '../services/database'
import { asyncHandler } from '../middleware'
import { LogsResponse, LogEntry } from '../types'

const router = Router()

router.get('/logs/:id', asyncHandler(async (req: Request, res: Response) => {
    const logSchema = z.object({
        id: z.string().uuid('Invalid deployment ID format')
    })
    
    const safeParseResult = logSchema.safeParse({ id: req.params.id })
    
    if (safeParseResult.error) {
        return res.status(400).json({ 
            error: 'Validation failed', 
            details: safeParseResult.error.issues 
        })
    }
    
    const { id } = safeParseResult.data

    const logs = await clickhouseClient.query({
        query: `SELECT event_id, deployment_id, log, timestamp from log_events where deployment_id = {deployment_id:String}`,
        query_params: {
            deployment_id: id
        },
        format: 'JSONEachRow'
    })

    const rawLogs = await logs.json() as LogEntry[]

    const response: LogsResponse = { logs: rawLogs }
    return res.json({ status: 'success', data: response })
}))

export default router
