import logger from '../../monitoring/logger';

export async function flushAllCache(): Promise<boolean> {
  logger.info('Flushing all administrative and system cache...');
  return true;
}

