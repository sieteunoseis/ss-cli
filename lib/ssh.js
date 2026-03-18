/**
 * lib/ssh.js
 * SSH into a server using credentials from a Secret Server secret.
 * Uses SSH_ASKPASS to provide the password without sshpass dependency.
 */

const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawn } = require('child_process');
const { getSecret, parseItems } = require('./get-secret');

async function sshFromSecret(baseUrl, apiToken, secretId, extraArgs) {
    const secret = await getSecret(baseUrl, apiToken, parseInt(secretId));
    const items = parseItems(secret);

    const username = items.username;
    const password = items.password;
    const host = items.resource || (items.url ? extractHost(items.url) : null) || items.host || items.machine || items.server;

    if (!username) throw new Error(`Secret ${secretId} has no "Username" field`);
    if (!host) throw new Error(`Secret ${secretId} has no "URL", "Host", "Machine", or "Server" field`);

    if (!password) {
        // No password — just SSH (key-based auth)
        console.error(`Connecting to ${username}@${host}...`);
        return spawnSSH(username, host, extraArgs);
    }

    // Create a temporary askpass script
    const askpassPath = path.join(os.tmpdir(), `.ss-cli-askpass-${process.pid}`);
    fs.writeFileSync(askpassPath, `#!/bin/sh\necho '${password.replace(/'/g, "'\\''")}'`, { mode: 0o700 });

    try {
        console.error(`Connecting to ${username}@${host}...`);
        return await spawnSSHWithPassword(username, host, askpassPath, extraArgs);
    } finally {
        // Always clean up the askpass script
        try { fs.unlinkSync(askpassPath); } catch {}
    }
}

function extractHost(url) {
    try {
        return new URL(url).hostname;
    } catch {
        // Not a URL, might just be a hostname
        return url.replace(/^https?:\/\//, '').replace(/[:/].*$/, '');
    }
}

function spawnSSH(username, host, extraArgs) {
    return new Promise((resolve) => {
        const args = [...(extraArgs || []), `${username}@${host}`];
        const child = spawn('ssh', args, { stdio: 'inherit' });
        child.on('error', (err) => { console.error(`SSH failed: ${err.message}`); resolve(1); });
        child.on('close', (code) => resolve(code || 0));
    });
}

function spawnSSHWithPassword(username, host, askpassPath, extraArgs) {
    return new Promise((resolve) => {
        const args = [...(extraArgs || []), `${username}@${host}`];
        const env = {
            ...process.env,
            SSH_ASKPASS: askpassPath,
            SSH_ASKPASS_REQUIRE: 'force',
            DISPLAY: process.env.DISPLAY || ':0'
        };

        const child = spawn('ssh', args, { stdio: 'inherit', env });
        child.on('error', (err) => { console.error(`SSH failed: ${err.message}`); resolve(1); });
        child.on('close', (code) => resolve(code || 0));
    });
}

module.exports = { sshFromSecret };
