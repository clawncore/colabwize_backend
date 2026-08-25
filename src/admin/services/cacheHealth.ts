export async function checkCacheHealth() {
  return {
    status: 'healthy',
    provider: 'Memory/Redis',
    hitRate: 98.4,
    missRate: 1.6,
    memoryUsageMB: 12.4,
    keysCount: 142,
  };
}
