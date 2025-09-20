import { ECSClient, RunTaskCommand } from '@aws-sdk/client-ecs'
import { AWS_CONFIG } from '../config/constants'
import { getEnvironmentConfig } from '../config/environment'

const env = getEnvironmentConfig()

export const createECSClient = (): ECSClient => {
    return new ECSClient({
        region: env.AWS_REGION,
        credentials: {
            accessKeyId: env.AWS_ACCESS_KEY_ID,
            secretAccessKey: env.AWS_SECRET_ACCESS_KEY
        },
        maxAttempts: AWS_CONFIG.MAX_ATTEMPTS,
        requestHandler: {
            requestTimeout: AWS_CONFIG.REQUEST_TIMEOUT,
            connectionTimeout: AWS_CONFIG.CONNECTION_TIMEOUT
        }
    })
}

export const createECSConfig = () => ({
    CLUSTER: env.ECS_CLUSTER,
    TASK: env.ECS_TASK_DEFINITION,
    SUBNETS: env.ECS_SUBNETS,
    SECURITY_GROUPS: env.ECS_SECURITY_GROUPS
})

export const runDeploymentTask = async (
    ecsClient: ECSClient,
    config: ReturnType<typeof createECSConfig>,
    gitURL: string,
    projectId: string,
    deploymentId: string
): Promise<void> => {
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
                        { name: 'PROJECT_ID', value: projectId },
                        { name: 'DEPLOYEMENT_ID', value: deploymentId },
                    ]
                }
            ]
        }
    })

    try {
        const result = await ecsClient.send(command)
        console.log('ECS task started successfully:', result.tasks?.[0]?.taskArn)
    } catch (err) {
        console.error('RunTask failed', { err, projectId, deploymentId })
        throw err
    }
}
