/**
 * lib/ssh.js
 * SSH into a server using credentials from a Secret Server secret.
 * Uses expect to handle password authentication (no sshpass dependency).
 */

const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawn, execFileSync } = require('child_process');
const { getSecret, parseItems } = require('./get-secret');

async function sshFromSecret(baseUrl, apiToken, secretId, extraArgs) {
    const secret = await getSecret(baseUrl, apiToken, parseInt(secretId));
    const items = parseItems(secret);

    const username = items.username;
    const password = items.password;
    const host = items.resource || (items.url ? extractHost(items.url) : null) || items.host || items.machine || items.server;

    if (!username) throw new Error(`Secret ${secretId} has no "Username" field`);
    if (!host) throw new Error(`Secret ${secretId} has no "URL", "Host", "Machine", or "Server" field`);

    console.error(`Connecting to ${username}@${host}...`);

    if (!password) {
        return spawnSSH(username, host, extraArgs);
    }

    // Try sshpass first, then expect, then SSH_ASKPASS
    if (hasCommand('sshpass')) {
        return spawnWithSshpass(username, host, password, extraArgs);
    } else if (hasCommand('expect')) {
        return spawnWithExpect(username, host, password, extraArgs);
    } else {
        return spawnWithAskpass(username, host, password, extraArgs);
    }
}

function extractHost(url) {
    try {
        return new URL(url).hostname;
    } catch {
        return url.replace(/^https?:\/\//, '').replace(/[:/].*$/, '');
    }
}

function hasCommand(cmd) {
    try {
        execFileSync('which', [cmd], { stdio: 'pipe' });
        return true;
    } catch {
        return false;
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

function spawnWithSshpass(username, host, password, extraArgs) {
    return new Promise((resolve) => {
        const args = ['-p', password, 'ssh', ...(extraArgs || []), `${username}@${host}`];
        const child = spawn('sshpass', args, { stdio: 'inherit' });
        child.on('error', (err) => { console.error(`SSH failed: ${err.message}`); resolve(1); });
        child.on('close', (code) => resolve(code || 0));
    });
}

function spawnWithExpect(username, host, password, extraArgs) {
    return new Promise((resolve) => {
        const sshArgs = [...(extraArgs || []), `${username}@${host}`].join(' ');
        const escapedPassword = password.replace(/[\\"$\[\]]/g, '\\$&');

        const expectScript = `
set timeout 30
spawn ssh ${sshArgs}
expect {
    "yes/no" { send "yes\\r"; exp_continue }
    "assword:" { send "${escapedPassword}\\r" }
    timeout { puts "Connection timed out"; exit 1 }
}
interact
`;

        const tmpFile = path.join(os.tmpdir(), `.ss-cli-expect-${process.pid}`);
        fs.writeFileSync(tmpFile, expectScript, { mode: 0o700 });

        const child = spawn('expect', [tmpFile], { stdio: 'inherit' });
        child.on('error', (err) => { console.error(`SSH failed: ${err.message}`); resolve(1); });
        child.on('close', (code) => {
            try { fs.unlinkSync(tmpFile); } catch {}
            resolve(code || 0);
        });
    });
}

function spawnWithAskpass(username, host, password, extraArgs) {
    return new Promise((resolve) => {
        const askpassPath = path.join(os.tmpdir(), `.ss-cli-askpass-${process.pid}`);
        fs.writeFileSync(askpassPath, `#!/bin/sh\necho '${password.replace(/'/g, "'\\''")}'`, { mode: 0o700 });

        const args = [...(extraArgs || []), `${username}@${host}`];
        const env = {
            ...process.env,
            SSH_ASKPASS: askpassPath,
            SSH_ASKPASS_REQUIRE: 'force',
            DISPLAY: process.env.DISPLAY || ':0'
        };

        const child = spawn('ssh', args, { stdio: 'inherit', env });
        child.on('error', (err) => { console.error(`SSH failed: ${err.message}`); resolve(1); });
        child.on('close', (code) => {
            try { fs.unlinkSync(askpassPath); } catch {}
            resolve(code || 0);
        });
    });
}

module.exports = { sshFromSecret };
