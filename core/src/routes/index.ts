import { Router } from 'express'
import projectsRouter from './projects'
import deploymentsRouter from './deployments'
import logsRouter from './logs'

const router = Router()

router.use(projectsRouter)
router.use(deploymentsRouter)
router.use(logsRouter)

export default router
