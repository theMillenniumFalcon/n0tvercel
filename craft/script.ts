import 'dotenv/config'
import { exec } from 'child_process'
import path from 'path'
import { S3Client, PutObjectCommand } from '@aws-sdk/client-s3'
import mime from 'mime-types'
import * as fs from 'fs'
import { promisify } from 'util'

const execAsync = promisify(exec)

const s3Client = new S3Client({
    region: process.env.AWS_REGION || '',
    credentials: {
        accessKeyId: process.env.AWS_ACCESS_KEY_ID || '',
        secretAccessKey: process.env.AWS_SECRET_ACCESS_KEY || ''
    },
})

const PROJECT_ID = process.env.PROJECT_ID

async function init() {
	try {
		console.log('Executing script.js')
		const outDirPath = path.join(__dirname, 'output')

		// Check if output directory exists
		try {
			await fs.promises.access(outDirPath)
		} catch (error) {
			throw new Error(`Output directory does not exist: ${outDirPath}`)
		}

		console.log('Starting build process...')
		const { stdout, stderr } = await execAsync(`cd ${outDirPath} && npm install && npm run build`)
		
		if (stdout) {
			console.log('Build output:', stdout)
		}
		if (stderr) {
			console.error('Build warnings/errors:', stderr)
		}

		console.log('Build Complete')
		await uploadFiles()
		
	} catch (error) {
		console.error('Fatal error in init:', error)
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
			throw new Error(`Dist directory does not exist: ${distFolderPath}`)
		}

		console.log('Discovering files to upload...')
		const filesToUpload = await getFilesToUpload(distFolderPath)
		console.log(`Found ${filesToUpload.length} files to upload`)

		if (filesToUpload.length === 0) {
			console.log('No files found to upload')
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
					console.error(`Failed to upload ${filesToUpload[currentIndex]}:`, error)
				}
				
				// Progress logging
				if ((completed + failed) % 10 === 0 || (completed + failed) === filesToUpload.length) {
					console.log(`Progress: ${completed + failed}/${filesToUpload.length} files processed (${completed} success, ${failed} failed)`)
				}
			}
		}

		const workerCount = Math.min(CONCURRENCY, filesToUpload.length)
		await Promise.all(Array.from({ length: workerCount }, () => worker()))
		
		console.log(`Upload complete! Success: ${completed}, Failed: ${failed}`)
		
		if (failed > 0) {
			console.warn(`${failed} files failed to upload. Check logs above for details.`)
		}
		
	} catch (error) {
		console.error('Error in uploadFiles:', error)
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
					console.error(`Error processing file ${item}:`, error)
					return null
				}
			})

			const batchResults = await Promise.all(batchPromises)
			filesToUpload.push(...batchResults.filter(Boolean))
		}

		return filesToUpload
	} catch (error) {
		console.error('Error getting files to upload:', error)
		throw error
	}
}

async function uploadOne(filePathStr: string, distFolderPath: string) {
	try {
		const absPath = path.join(distFolderPath, filePathStr)
		
		// Verify file exists before attempting upload
		await fs.promises.access(absPath)
		
		console.log('uploading', filePathStr)
		const command = new PutObjectCommand({
			Bucket: 'n0tvercel-outputs',
			Key: `__outputs/${PROJECT_ID}/${filePathStr}`,
			Body: fs.createReadStream(absPath),
			ContentType: (mime.lookup(filePathStr) || undefined) as string | undefined
		})
		
		await s3Client.send(command)
		console.log('uploaded', filePathStr)
		
	} catch (error) {
		console.error(`Error uploading ${filePathStr}:`, error)
		throw error
	}
}

init()