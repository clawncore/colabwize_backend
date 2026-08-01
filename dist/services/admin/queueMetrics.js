"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.getQueueMetrics = getQueueMetrics;
async function getQueueMetrics() {
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
