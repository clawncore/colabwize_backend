// Puppeteer setup script for Render deployment
const fs = require('fs');
const path = require('path');

// Create puppeteer cache directory if it doesn't exist
const puppeteerCacheDir = process.env.PUPPETEER_CACHE_DIR || '/opt/render/project/src/backend/.cache/puppeteer';
const cacheDir = path.dirname(puppeteerCacheDir);

console.log('Setting up Puppeteer cache directory:', cacheDir);

try {
    if (!fs.existsSync(cacheDir)) {
        fs.mkdirSync(cacheDir, { recursive: true });
        console.log('Created Puppeteer cache directory');
    } else {
        console.log('Puppeteer cache directory already exists');
    }
} catch (error) {
    console.error('Error creating Puppeteer cache directory:', error.message);
}

// Log Puppeteer configuration
console.log('PUPPETEER_EXECUTABLE_PATH:', process.env.PUPPETEER_EXECUTABLE_PATH || 'Not set');
console.log('PUPPETEER_CACHE_DIR:', process.env.PUPPETEER_CACHE_DIR || 'Not set');