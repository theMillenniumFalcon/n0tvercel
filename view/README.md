# Deployment Dashboard

A Next.js application for deploying GitHub repositories and monitoring deployment logs in real-time.

## Features

- **GitHub URL Input**: Enter your GitHub repository URL to create a project
- **Real-time Logs**: Monitor deployment logs with automatic polling
- **Modern UI**: Built with shadcn/ui components and Tailwind CSS
- **Status Tracking**: Visual indicators for project and deployment status

## Setup

1. Install dependencies:
   ```bash
   npm install
   ```

2. Set environment variables:
   Create a `.env.local` file in the root directory:
   ```
   NEXT_PUBLIC_API_URL=http://localhost:3001
   ```

3. Start the development server:
   ```bash
   npm run dev
   ```

## Usage

1. Enter your GitHub repository URL in the input field
2. Click "Create Project" to register your repository
3. Click "Deploy" to start the deployment process
4. Monitor real-time logs in the deployment logs section
5. Use "Reset" to start over with a new repository

## API Integration

The application integrates with the core API endpoints:
- `POST /project` - Create a new project
- `POST /deploy` - Start a deployment
- `GET /logs/:id` - Fetch deployment logs

## Technology Stack

- **Next.js 15** - React framework
- **shadcn/ui** - UI component library
- **Tailwind CSS** - Styling
- **TypeScript** - Type safety