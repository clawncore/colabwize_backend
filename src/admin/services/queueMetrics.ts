import logger from '../../monitoring/logger';

export async function getQueueMetrics() {
  return {
    connected: true,
    configured: false,
    pendingJobs: 0,
    completedJobs: 0,
    failedJobs: 0,
    activeWorkers: 1,
    concurrency: 5,
  };
}
