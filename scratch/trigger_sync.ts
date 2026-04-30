
import { processIncomingSupportEmails } from '../src/services/email/inboxFetcher';
import logger from '../src/monitoring/logger';

async function testSync() {
    console.log('Starting manual sync test...');
    try {
        await processIncomingSupportEmails();
        console.log('Sync process completed.');
    } catch (error) {
        console.error('Sync process failed:', error);
    }
}

testSync();
