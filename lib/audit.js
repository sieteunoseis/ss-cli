/**
 * lib/audit.js
 * Append-only JSONL audit log with HMAC-SHA256 chain for tamper detection.
 * Logs secret access (never secret values).
 */

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { CONFIG_DIR } = require('./config');

const AUDIT_FILE = path.join(CONFIG_DIR, 'audit.jsonl');
const HMAC_KEY = 'ss-cli-audit-v1'; // Public key — HMAC proves chain integrity, not secrecy

function getLastHmac() {
    try {
        const lines = fs.readFileSync(AUDIT_FILE, 'utf8').trim().split('\n');
        if (lines.length === 0 || lines[0] === '') return '0';
        const last = JSON.parse(lines[lines.length - 1]);
        return last.hmac;
    } catch {
        return '0';
    }
}

function computeHmac(entry, prevHmac) {
    const payload = `${prevHmac}|${entry.ts}|${entry.cmd}|${entry.target}|${entry.success}`;
    return crypto.createHmac('sha256', HMAC_KEY).update(payload).digest('hex');
}

function log(cmd, target, success) {
    const prev = getLastHmac();
    const entry = {
        ts: new Date().toISOString(),
        cmd,
        target: String(target),
        success,
        prev
    };
    entry.hmac = computeHmac(entry, prev);

    fs.mkdirSync(CONFIG_DIR, { recursive: true });
    fs.appendFileSync(AUDIT_FILE, JSON.stringify(entry) + '\n');
}

function readLog(limit) {
    try {
        const lines = fs.readFileSync(AUDIT_FILE, 'utf8').trim().split('\n').filter(Boolean);
        const entries = lines.map(l => JSON.parse(l));
        return limit ? entries.slice(-limit) : entries;
    } catch {
        return [];
    }
}

function verifyChain() {
    const entries = readLog();
    if (entries.length === 0) return { valid: true, count: 0, errors: [] };

    const errors = [];

    // First entry's prev should be '0'
    if (entries[0].prev !== '0') {
        errors.push({ index: 0, error: 'First entry prev is not "0"' });
    }

    for (let i = 0; i < entries.length; i++) {
        const entry = entries[i];
        const expectedPrev = i === 0 ? '0' : entries[i - 1].hmac;
        const expectedHmac = computeHmac(entry, expectedPrev);

        if (entry.prev !== expectedPrev) {
            errors.push({ index: i, error: `prev mismatch (expected ${expectedPrev.slice(0, 8)}..., got ${entry.prev.slice(0, 8)}...)` });
        }
        if (entry.hmac !== expectedHmac) {
            errors.push({ index: i, error: `hmac mismatch (entry tampered)` });
        }
    }

    return { valid: errors.length === 0, count: entries.length, errors };
}

module.exports = { log, readLog, verifyChain, AUDIT_FILE };
