
import { PrismaClient } from '@prisma/client';

console.log('PrismaClient version:', require('@prisma/client/package.json').version);

try {
    const prisma = new PrismaClient({
        datasources: {
            db: {
                url: 'postgresql://test:test@localhost:5432/test'
            }
        }
    });
    console.log('Successfully created PrismaClient with datasources');
} catch (e) {
    console.error('Failed to create PrismaClient with datasources:', e.message);
}

try {
    const prisma = new PrismaClient({
        datasourceUrl: 'postgresql://test:test@localhost:5432/test'
    });
    console.log('Successfully created PrismaClient with datasourceUrl');
} catch (e) {
    console.error('Failed to create PrismaClient with datasourceUrl:', e.message);
}
