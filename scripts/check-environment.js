#!/usr/bin/env node

/**
 * Environment Verification Script
 * Checks if LibreOffice and Chrome are available for PDF processing
 */

const { spawn } = require('child_process');

const checks = [
    {
        name: 'LibreOffice',
        command: 'libreoffice',
        args: ['--version'],
        purpose: 'PDF to DOCX conversion',
        required: true
    },
    {
        name: 'Google Chrome',
        command: 'google-chrome-stable',
        args: ['--version'],
        purpose: 'PDF export via Puppeteer',
        required: true
    },
    {
        name: 'Puppeteer Chrome Path',
        command: process.env.PUPPETEER_EXECUTABLE_PATH || '/usr/bin/google-chrome-stable',
        args: ['--version'],
        purpose: 'Verify Puppeteer Chrome config',
        required: true
    }
];

async function checkCommand(check) {
    return new Promise((resolve) => {
        const proc = spawn(check.command, check.args);
        let output = '';
        let error = '';

        proc.stdout.on('data', (data) => {
            output += data.toString();
        });

        proc.stderr.on('data', (data) => {
            error += data.toString();
        });

        proc.on('close', (code) => {
            resolve({
                ...check,
                available: code === 0,
                version: output.trim() || error.trim(),
                code
            });
        });

        proc.on('error', (err) => {
            resolve({
                ...check,
                available: false,
                error: err.message
            });
        });
    });
}

async function main() {
    console.log('\n🔍 ColabWize Environment Check\n');
    console.log('Verifying PDF processing dependencies...\n');

    const results = [];
    for (const check of checks) {
        process.stdout.write(`Checking ${check.name}... `);
        const result = await checkCommand(check);
        results.push(result);

        if (result.available) {
            console.log('✅ Available');
            if (result.version) {
                console.log(`   Version: ${result.version.split('\n')[0]}`);
            }
        } else {
            console.log('❌ Not Found');
            if (result.error) {
                console.log(`   Error: ${result.error}`);
            }
        }
        console.log(`   Purpose: ${result.purpose}\n`);
    }

    // Summary
    const allAvailable = results.every(r => r.available);
    const criticalMissing = results.filter(r => r.required && !r.available);

    console.log('\n' + '='.repeat(60));
    console.log('📊 Summary\n');

    if (allAvailable) {
        console.log('✅ All dependencies are available!');
        console.log('   PDF uploads and exports should work correctly.\n');
        process.exit(0);
    } else {
        console.log('❌ Some dependencies are missing:\n');
        criticalMissing.forEach(check => {
            console.log(`   - ${check.name} (${check.purpose})`);
        });

        console.log('\n💡 Installation Instructions:\n');

        if (criticalMissing.some(c => c.name === 'LibreOffice')) {
            console.log('   LibreOffice:');
            console.log('   - Ubuntu/Debian: apt-get install libreoffice');
            console.log('   - Windows: Download from https://www.libreoffice.org\n');
        }

        if (criticalMissing.some(c => c.name.includes('Chrome'))) {
            console.log('   Google Chrome:');
            console.log('   - Ubuntu/Debian: apt-get install google-chrome-stable');
            console.log('   - Docker: Use provided Dockerfile\n');
        }

        console.log('   See: pdf-upload-fix.md for detailed instructions\n');
        process.exit(1);
    }
}

main().catch(err => {
    console.error('❌ Error running environment check:', err.message);
    process.exit(1);
});
