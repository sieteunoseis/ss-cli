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

    // Get SSH filters from config
    const sshTemplates = getConfigValue('sshTemplates');
    const sshFolder = getConfigValue('sshFolder');
    const templateIds = sshTemplates ? String(sshTemplates).split(',').map(s => s.trim()) : [];
    const folderId = sshFolder ? String(sshFolder) : null;

    // Search by hostname — strip domain for shorter search
    const searchTerm = target.split('.')[0];

    if (templateIds.length === 0 && !folderId) {
        console.error(`No sshTemplates or sshFolder configured. Run:`);
        console.error(`  ss-cli config set sshTemplates 6007,6010`);
        console.error(`  ss-cli config set sshFolder 1234`);
        console.error(`Searching all secrets for "${searchTerm}"...`);
        return resolveFromResults(baseUrl, apiToken, await searchSecrets(baseUrl, apiToken, searchTerm), searchTerm);
    }

    // Build search queries: by folder, and/or by each template
    let allResults = [];
    const seen = new Set();

    if (folderId) {
        const results = await searchSecrets(baseUrl, apiToken, searchTerm, folderId);
        results.forEach(r => { if (!seen.has(r.id)) { seen.add(r.id); allResults.push(r); } });
    }

    for (const tid of templateIds) {
        const results = await searchSecrets(baseUrl, apiToken, searchTerm, null, tid);
        results.forEach(r => { if (!seen.has(r.id)) { seen.add(r.id); allResults.push(r); } });
    }

    if (allResults.length === 0) {
        throw new Error(`No SSH secrets found matching "${searchTerm}". Check sshTemplates/sshFolder config or use secret ID.`);
    }

    if (allResults.length === 1) {
        const secret = await getSecret(baseUrl, apiToken, allResults[0].id);
        console.error(`Found: [${secret.id}] ${secret.name}`);
        return secret;
    }

    // Multiple matches — find exact hostname match by name
    const exact = allResults.find(r =>
        r.name.toLowerCase() === target.toLowerCase() ||
        r.name.toLowerCase() === `${searchTerm}.ohsu.edu`.toLowerCase() ||
        r.name.toLowerCase() === searchTerm.toLowerCase()
    );
    if (exact) {
        const secret = await getSecret(baseUrl, apiToken, exact.id);
        console.error(`Found: [${secret.id}] ${secret.name}`);
        return secret;
    }

    // List options
    console.error(`Multiple SSH secrets found matching "${searchTerm}":`);
    allResults.forEach(r => console.error(`  [${r.id}] ${r.name}`));
    throw new Error(`Be more specific, or use the secret ID directly: ss-cli ssh <id>`);
}

async function resolveFromResults(baseUrl, apiToken, results, searchTerm) {
    if (results.length === 0) {
        throw new Error(`No secrets found matching "${searchTerm}"`);
    }
    if (results.length === 1) {
        const secret = await getSecret(baseUrl, apiToken, results[0].id);
        console.error(`Found: [${secret.id}] ${secret.name}`);
        return secret;
    }
    // Check first 5 for resource/host field match
    for (let i = 0; i < Math.min(results.length, 5); i++) {
        const secret = await getSecret(baseUrl, apiToken, results[i].id);
        const items = parseItems(secret);
        const host = items.resource || items.host || items.machine || items.server || '';
        if (host.toLowerCase().includes(searchTerm.toLowerCase())) {
            console.error(`Found: [${secret.id}] ${secret.name} → ${host}`);
            return secret;
        }
    }
    console.error(`Multiple secrets found matching "${searchTerm}":`);
    results.slice(0, 10).forEach(r => console.error(`  [${r.id}] ${r.name}`));
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
