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
const { searchSecrets } = require('./search-secrets');
const { getConfigValue } = require('./config');

async function resolveSecret(baseUrl, apiToken, target) {
    // If numeric, treat as secret ID
    if (/^\d+$/.test(target)) {
        return getSecret(baseUrl, apiToken, parseInt(target));
    }

    // Otherwise search by hostname
    console.error(`Searching for "${target}"...`);
    const results = await searchSecrets(baseUrl, apiToken, target);

    if (results.length === 0) {
        throw new Error(`No secrets found matching "${target}"`);
    }

    // Fetch full details for each result and match on Resource field
    for (const r of results) {
        const secret = await getSecret(baseUrl, apiToken, r.id);
        const items = parseItems(secret);
        const resource = items.resource || items.host || items.machine || items.server || '';
        if (resource.toLowerCase().includes(target.toLowerCase())) {
            console.error(`Found: [${secret.id}] ${secret.name} → ${resource}`);
            return secret;
        }
    }

    // No resource match — show options and use first result
    if (results.length === 1) {
        const secret = await getSecret(baseUrl, apiToken, results[0].id);
        console.error(`Found: [${secret.id}] ${secret.name}`);
        return secret;
    }

    // Multiple results, no resource match — list them
    console.error(`Multiple secrets found matching "${target}":`);
    for (const r of results) {
        console.error(`  [${r.id}] ${r.name}`);
    }
    throw new Error(`Be more specific, or use the secret ID directly: ss-cli ssh <id>`);
}

async function sshFromSecret(baseUrl, apiToken, target, extraArgs) {
    const secret = await resolveSecret(baseUrl, apiToken, target);
    const items = parseItems(secret);

    const username = items.username || getConfigValue('sshUsername');
    const password = items.password;
    const host = items.resource || (items.url ? extractHost(items.url) : null) || items.host || items.machine || items.server;

    if (!username) throw new Error(`No username found. Set a default: ss-cli config set sshUsername <user>`);
    if (!host) throw new Error(`Secret has no "Resource", "URL", "Host", "Machine", or "Server" field`);

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

async function sshCopyIdFromSecret(baseUrl, apiToken, target, extraArgs) {
    const secret = await resolveSecret(baseUrl, apiToken, target);
    const items = parseItems(secret);

    const username = items.username || getConfigValue('sshUsername');
    const password = items.password;
    const host = items.resource || (items.url ? extractHost(items.url) : null) || items.host || items.machine || items.server;

    if (!username) throw new Error(`No username found. Set a default: ss-cli config set sshUsername <user>`);
    if (!host) throw new Error(`Secret has no "Resource", "URL", "Host", "Machine", or "Server" field`);
    if (!password) throw new Error(`Secret has no "Password" field (needed for ssh-copy-id)`);

    console.error(`Copying SSH key to ${username}@${host}...`);

    if (hasCommand('sshpass')) {
        return spawnWithSshpassCmd('ssh-copy-id', username, host, password, extraArgs);
    } else if (hasCommand('expect')) {
        return spawnWithExpectCmd('ssh-copy-id', username, host, password, extraArgs);
    } else {
        console.error('Error: ssh-copy-id requires sshpass or expect. Install one: sudo apt install sshpass');
        return 1;
    }
}

function spawnWithSshpassCmd(cmd, username, host, password, extraArgs) {
    return new Promise((resolve) => {
        const args = ['-p', password, cmd, ...(extraArgs || []), `${username}@${host}`];
        const child = spawn('sshpass', args, { stdio: 'inherit' });
        child.on('error', (err) => { console.error(`Failed: ${err.message}`); resolve(1); });
        child.on('close', (code) => resolve(code || 0));
    });
}

function spawnWithExpectCmd(cmd, username, host, password, extraArgs) {
    return new Promise((resolve) => {
        const cmdArgs = [...(extraArgs || []), `${username}@${host}`].join(' ');
        const escapedPassword = password.replace(/[\\"$\[\]]/g, '\\$&');

        const expectScript = `
set timeout 30
spawn ${cmd} ${cmdArgs}
expect {
    "yes/no" { send "yes\\r"; exp_continue }
    -nocase "assword:" { send "${escapedPassword}\\r" }
    timeout { puts "Connection timed out"; exit 1 }
}
expect eof
`;

        const tmpFile = path.join(os.tmpdir(), `.ss-cli-expect-${process.pid}`);
        fs.writeFileSync(tmpFile, expectScript, { mode: 0o700 });

        const child = spawn('expect', [tmpFile], { stdio: 'inherit' });
        child.on('error', (err) => { console.error(`Failed: ${err.message}`); resolve(1); });
        child.on('close', (code) => {
            try { fs.unlinkSync(tmpFile); } catch {}
            resolve(code || 0);
        });
    });
}

module.exports = { sshFromSecret, sshCopyIdFromSecret };
