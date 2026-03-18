/**
 * lib/run.js
 * Fetch secrets and inject as env vars into a subprocess.
 * Secrets exist only in the child process's memory — never written to disk.
 */

const fs = require('fs');
const { spawn } = require('child_process');
const { getSecret, parseItems } = require('./get-secret');

async function runWithMapFile(baseUrl, apiToken, mapFile, command, args) {
    const map = JSON.parse(fs.readFileSync(mapFile, 'utf8'));
    const secretEnv = {};

    for (const entry of map) {
        process.stderr.write(`[${entry.secretId}] ${entry.name || 'secret'}... `);
        const secret = await getSecret(baseUrl, apiToken, entry.secretId);
        const items = parseItems(secret);

        for (const [field, envVar] of Object.entries(entry.fields)) {
            let value = items[field];
            if (entry.transforms && entry.transforms[field]) {
                if (entry.transforms[field] === 'hostname') value = new URL(value).hostname;
                else if (entry.transforms[field] === 'dbname') value = new URL(value).pathname.replace('/', '');
            }
            if (value !== undefined) secretEnv[envVar] = value;
        }
        process.stderr.write('OK\n');
    }

    return spawnWithEnv(secretEnv, command, args);
}

async function runWithSecret(baseUrl, apiToken, secretId, prefix, command, args) {
    const secret = await getSecret(baseUrl, apiToken, parseInt(secretId));
    const items = parseItems(secret);
    const secretEnv = {};

    for (const [field, value] of Object.entries(items)) {
        const envName = prefix
            ? `${prefix}${field.toUpperCase()}`
            : field.toUpperCase();
        secretEnv[envName] = value;
    }

    return spawnWithEnv(secretEnv, command, args);
}

function spawnWithEnv(secretEnv, command, args) {
    const env = { ...process.env, ...secretEnv };

    return new Promise((resolve) => {
        const child = spawn(command, args, {
            env,
            stdio: 'inherit',
            shell: process.platform === 'win32'
        });

        child.on('error', (err) => {
            console.error(`Failed to start: ${err.message}`);
            resolve(1);
        });

        child.on('close', (code) => {
            resolve(code || 0);
        });
    });
}

module.exports = { runWithMapFile, runWithSecret };
