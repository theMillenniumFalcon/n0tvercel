import { Request, Response } from 'express'
import { getEnvironmentConfig } from '../config/environment'

const env = getEnvironmentConfig()

export const errorHandler = (err: Error, req: Request, res: Response, next: any) => {
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
        message: env.NODE_ENV === 'development' ? err.message : 'Something went wrong'
    })
}
