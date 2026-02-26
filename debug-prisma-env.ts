
import { PrismaClient } from '@prisma/client';

console.log('Testing PrismaClient with empty object {}...');

process.env.DATABASE_URL = 'postgresql://test:test@localhost:5432/test?connection_limit=20&pool_timeout=60';

try {
    const prisma = new PrismaClient({});
    console.log('Successfully created PrismaClient with empty object {}');
} catch (e) {
    console.error('Failed to create PrismaClient with empty object {}:', e.message);
}
