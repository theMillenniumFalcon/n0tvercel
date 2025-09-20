"use client";

import { useState, useEffect, useRef } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { apiClient } from "@/lib/api";
import { LogEntry } from "@/types/api";

export default function Home() {
  const [gitUrl, setGitUrl] = useState("");
  const [projectId, setProjectId] = useState<string | null>(null);
  const [deploymentId, setDeploymentId] = useState<string | null>(null);
  const [logs, setLogs] = useState<LogEntry[]>([]);
  const [isLoading, setIsLoading] = useState(false);
  const [isDeploying, setIsDeploying] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [status, setStatus] = useState<string>("idle");
  
  const pollingIntervalRef = useRef<NodeJS.Timeout | null>(null);
  const logsContainerRef = useRef<HTMLDivElement>(null);

  // Auto-scroll to bottom of logs
  useEffect(() => {
    if (logsContainerRef.current) {
      logsContainerRef.current.scrollTop = logsContainerRef.current.scrollHeight;
    }
  }, [logs]);

  // Polling for logs when deployment is active
  useEffect(() => {
    if (deploymentId && isDeploying) {
      pollingIntervalRef.current = setInterval(async () => {
        try {
          const response = await apiClient.getLogs(deploymentId);
          if (response.status === 'success' && response.data) {
            setLogs(response.data.logs);
            
            // Check if deployment is complete (you might want to add a status endpoint)
            // For now, we'll stop polling after 5 minutes
            const lastLog = response.data.logs[response.data.logs.length - 1];
            if (lastLog && lastLog.log.includes('deployment completed')) {
              setIsDeploying(false);
              setStatus('completed');
            }
          }
        } catch (err) {
          console.error('Error fetching logs:', err);
          setError('Failed to fetch logs');
        }
      }, 2000); // Poll every 2 seconds

      return () => {
        if (pollingIntervalRef.current) {
          clearInterval(pollingIntervalRef.current);
        }
      };
    }
  }, [deploymentId, isDeploying]);

  const handleCreateProject = async () => {
    if (!gitUrl.trim()) {
      setError('Please enter a GitHub URL');
      return;
    }

    setIsLoading(true);
    setError(null);

    try {
      // Extract project name from URL
      const projectName = gitUrl.split('/').pop()?.replace('.git', '') || 'project';
      
      const response = await apiClient.createProject({
        name: projectName,
        gitURL: gitUrl.trim(),
      });

      if (response.status === 'success' && response.data) {
        setProjectId(response.data.project.id);
        setStatus('project-created');
      } else {
        setError(response.error || 'Failed to create project');
      }
    } catch (err) {
      setError('Failed to create project');
      console.error('Error creating project:', err);
    } finally {
      setIsLoading(false);
    }
  };

  const handleDeploy = async () => {
    if (!projectId) {
      setError('Please create a project first');
      return;
    }

    setIsDeploying(true);
    setError(null);
    setLogs([]);

    try {
      const response = await apiClient.deployProject({
        projectId,
      });

      if (response.status === 'queued' && response.data) {
        setDeploymentId(response.data.deploymentId);
        setStatus('deploying');
      } else {
        setError(response.error || 'Failed to start deployment');
        setIsDeploying(false);
      }
    } catch (err) {
      setError('Failed to start deployment');
      setIsDeploying(false);
      console.error('Error starting deployment:', err);
    }
  };

  const handleReset = () => {
    setProjectId(null);
    setDeploymentId(null);
    setLogs([]);
    setIsDeploying(false);
    setStatus('idle');
    setError(null);
    
    if (pollingIntervalRef.current) {
      clearInterval(pollingIntervalRef.current);
    }
  };

  const getStatusBadge = () => {
    switch (status) {
      case 'project-created':
        return <Badge variant="secondary">Project Created</Badge>;
      case 'deploying':
        return <Badge variant="default">Deploying</Badge>;
      case 'completed':
        return <Badge variant="secondary">Completed</Badge>;
      default:
        return null;
    }
  };

  return (
    <div className="min-h-screen bg-background p-8">
      <div className="max-w-4xl mx-auto space-y-8">
        <div className="text-center space-y-4">
          <h1 className="text-4xl font-bold">Deployment Dashboard</h1>
          <p className="text-muted-foreground">
            Deploy your GitHub repository and monitor logs in real-time
          </p>
        </div>

        <Card>
          <CardHeader>
            <CardTitle>GitHub Repository</CardTitle>
            <CardDescription>
              Enter your GitHub repository URL to start deployment
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="flex gap-4">
              <Input
                placeholder="https://github.com/username/repository.git"
                value={gitUrl}
                onChange={(e) => setGitUrl(e.target.value)}
                disabled={isLoading || isDeploying}
                className="flex-1"
              />
              <Button 
                onClick={handleCreateProject}
                disabled={isLoading || isDeploying || !gitUrl.trim()}
              >
                {isLoading ? "Creating..." : "Create Project"}
              </Button>
            </div>

            {projectId && (
              <div className="flex items-center gap-4">
                <div className="flex items-center gap-2">
                  <span className="text-sm text-muted-foreground">Project ID:</span>
                  <code className="text-sm bg-muted px-2 py-1 rounded">
                    {projectId}
                  </code>
                  {getStatusBadge()}
                </div>
                <Button 
                  onClick={handleDeploy}
                  disabled={isDeploying}
                  variant="default"
                >
                  {isDeploying ? "Deploying..." : "Deploy"}
                </Button>
                <Button 
                  onClick={handleReset}
                  variant="outline"
                  disabled={isDeploying}
                >
                  Reset
                </Button>
              </div>
            )}

            {error && (
              <div className="p-4 bg-destructive/10 border border-destructive/20 rounded-md">
                <p className="text-destructive text-sm">{error}</p>
              </div>
            )}
          </CardContent>
        </Card>

        {deploymentId && (
          <Card>
            <CardHeader>
              <CardTitle className="flex items-center gap-2">
                Deployment Logs
                {isDeploying && (
                  <Badge variant="default" className="animate-pulse">
                    Live
                  </Badge>
                )}
              </CardTitle>
              <CardDescription>
                Real-time logs for deployment {deploymentId}
              </CardDescription>
            </CardHeader>
            <CardContent>
              <div 
                ref={logsContainerRef}
                className="h-96 overflow-y-auto bg-black text-green-400 p-4 rounded-md font-mono text-sm space-y-1"
              >
                {logs.length === 0 ? (
                  <div className="text-gray-500">
                    {isDeploying ? "Waiting for logs..." : "No logs available"}
                  </div>
                ) : (
                  logs.map((log, index) => (
                    <div key={log.event_id || index} className="flex gap-2">
                      <span className="text-gray-500 shrink-0">
                        {new Date(log.timestamp).toLocaleTimeString()}
                      </span>
                      <span>{log.log}</span>
                    </div>
                  ))
                )}
              </div>
            </CardContent>
          </Card>
        )}
      </div>
    </div>
  );
}
