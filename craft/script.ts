import 'dotenv/config'
import { exec } from 'child_process'
import path from 'path'
import { S3Client, PutObjectCommand } from '@aws-sdk/client-s3'
import mime from 'mime-types'
import { Kafka } from 'kafkajs'
import * as fs from 'fs'
import { promisify } from 'util'

// Constants
const KAFKA_TOPICS = {
    CONTAINER_LOGS: 'container-logs'
} as const

const KAFKA_CONFIG = {
    CLIENT_ID_PREFIX: 'docker-craft-',
    SASL_MECHANISM: 'plain' as const
} as const

const execAsync = promisify(exec)

const s3Client = new S3Client({
    region: process.env.AWS_REGION || '',
    credentials: {
        accessKeyId: process.env.AWS_ACCESS_KEY_ID || '',
        secretAccessKey: process.env.AWS_SECRET_ACCESS_KEY || ''
    },
})

const PROJECT_ID = process.env.PROJECT_ID
const DEPLOYMENT_ID = process.env.DEPLOYMENT_ID

const kafka = new Kafka({
    clientId: `${KAFKA_CONFIG.CLIENT_ID_PREFIX}${DEPLOYMENT_ID}`,
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

const producer = kafka.producer()

// Graceful shutdown handler
async function gracefulShutdown() {
    try {
        console.log('Shutting down gracefully...')
        await producer.disconnect()
        console.log('Kafka producer disconnected')
        process.exit(0)
    } catch (error) {
        console.error('Error during graceful shutdown:', error)
        process.exit(1)
    }
}

// Register shutdown handlers
process.on('SIGINT', gracefulShutdown)
process.on('SIGTERM', gracefulShutdown)
process.on('uncaughtException', async (error) => {
    console.error('Uncaught exception:', error)
    await gracefulShutdown()
})
process.on('unhandledRejection', async (reason, promise) => {
    console.error('Unhandled rejection at:', promise, 'reason:', reason)
    await gracefulShutdown()
})

async function publishLog(log: string) {
    try {
        await producer.send({
            topic: KAFKA_TOPICS.CONTAINER_LOGS,
            messages: [{
                key: 'log',
                value: JSON.stringify({ PROJECT_ID, DEPLOYMENT_ID, log })
            }]
        })
    } catch (error) {
        // Fallback to console logging if Kafka fails
        console.error('Failed to publish log to Kafka:', error)
        console.log(`[FALLBACK LOG] ${log}`)
        
        // Don't throw the error to prevent breaking the main flow
        // The application should continue even if logging fails
    }
}

async function init() {
	try {
		// Connect to Kafka with error handling
		try {
			await producer.connect()
			console.log('Successfully connected to Kafka')
		} catch (error) {
			console.error('Failed to connect to Kafka:', error)
			// Continue execution with fallback logging
			console.log('Continuing with console logging fallback')
		}
		
		await publishLog('Executing script.js')
		const outDirPath = path.join(__dirname, 'output')

		// Check if output directory exists
		try {
			await fs.promises.access(outDirPath)
		} catch (error) {
			await publishLog(`Error: Output directory does not exist: ${outDirPath}`)
			throw new Error(`Output directory does not exist: ${outDirPath}`)
		}

		await publishLog('Starting build process...')
		const { stdout, stderr } = await execAsync(`cd ${outDirPath} && npm install && npm run build`)
		
		if (stdout) {
			await publishLog(`Build output: ${stdout}`)
		}
		if (stderr) {
			await publishLog(`Build warnings/errors: ${stderr}`)
		}

		await publishLog('Build Complete')
		await uploadFiles()
		
	} catch (error) {
		await publishLog(`Fatal error in init: ${error}`)
		process.exit(1)
	}
}

async function uploadFiles() {
	try {
		const distFolderPath = path.join(__dirname, 'output', 'dist')
		
		// Check if dist directory exists
		try {
			await fs.promises.access(distFolderPath)
		} catch (error) {
			await publishLog(`Error: Dist directory does not exist: ${distFolderPath}`)
			throw new Error(`Dist directory does not exist: ${distFolderPath}`)
		}

		await publishLog('Discovering files to upload...')
		const filesToUpload = await getFilesToUpload(distFolderPath)
		await publishLog(`Found ${filesToUpload.length} files to upload`)

		if (filesToUpload.length === 0) {
			await publishLog('No files found to upload')
			return
		}

		// Concurrency-limited worker pool
		const CONCURRENCY = 100
		let nextIndex = 0
		let completed = 0
		let failed = 0

		const worker = async () => {
			while (true) {
				const currentIndex = nextIndex++
				if (currentIndex >= filesToUpload.length) break
				
				try {
					await uploadOne(filesToUpload[currentIndex], distFolderPath)
					completed++
				} catch (error) {
					failed++
					await publishLog(`Failed to upload ${filesToUpload[currentIndex]}: ${error}`)
				}
				
				// Progress logging
				if ((completed + failed) % 10 === 0 || (completed + failed) === filesToUpload.length) {
					await publishLog(`Progress: ${completed + failed}/${filesToUpload.length} files processed (${completed} success, ${failed} failed)`)
				}
			}
		}

		const workerCount = Math.min(CONCURRENCY, filesToUpload.length)
		await Promise.all(Array.from({ length: workerCount }, () => worker()))
		
		await publishLog(`Upload complete! Success: ${completed}, Failed: ${failed}`)
		
		if (failed > 0) {
			await publishLog(`Warning: ${failed} files failed to upload. Check logs above for details.`)
		}
		
	} catch (error) {
		await publishLog(`Error in uploadFiles: ${error}`)
		throw error
	}
}

async function getFilesToUpload(distFolderPath: string): Promise<string[]> {
	try {
		const allItems = await fs.promises.readdir(distFolderPath, { recursive: true })
		const filesToUpload: string[] = []

		// Process items in batches to avoid overwhelming the file system
		const BATCH_SIZE = 50
		for (let i = 0; i < allItems.length; i += BATCH_SIZE) {
			const batch = allItems.slice(i, i + BATCH_SIZE)
			
			const batchPromises = batch.map(async (item: any) => {
				try {
					const filePathStr = typeof item === 'string' ? item : item.toString()
					const absPath = path.join(distFolderPath, filePathStr)
					const stats = await fs.promises.lstat(absPath)
					
					if (!stats.isDirectory()) {
						return filePathStr
					}
					return null
				} catch (error) {
					await publishLog(`Error processing file ${item}: ${error}`)
					return null
				}
			})

			const batchResults = await Promise.all(batchPromises)
			filesToUpload.push(...batchResults.filter(Boolean))
		}

		return filesToUpload
	} catch (error) {
		await publishLog(`Error getting files to upload: ${error}`)
		throw error
	}
}

async function uploadOne(filePathStr: string, distFolderPath: string) {
	try {
		const absPath = path.join(distFolderPath, filePathStr)
		
		// Verify file exists before attempting upload
		await fs.promises.access(absPath)
		
		await publishLog(`Uploading ${filePathStr}`)
		const command = new PutObjectCommand({
			Bucket: 'n0tvercel-outputs',
			Key: `__outputs/${PROJECT_ID}/${filePathStr}`,
			Body: fs.createReadStream(absPath),
			ContentType: (mime.lookup(filePathStr) || undefined) as string | undefined
		})
		
		await s3Client.send(command)
		await publishLog(`Uploaded ${filePathStr}`)
		
	} catch (error) {
		await publishLog(`Error uploading ${filePathStr}: ${error}`)
		throw error
	}
}

init()