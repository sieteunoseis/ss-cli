/**
 * lib/resolve.js
 * Replace <ss:SECRET_ID:FIELD> placeholders in any file with actual secret values.
 * Caches fetched secrets to avoid duplicate API calls.
 */

const fs = require('fs');
const { getSecret, parseItems } = require('./get-secret');

const PLACEHOLDER_RE = /<ss:(\d+):(\w+)>/g;

async function resolve(baseUrl, apiToken, input) {
    const cache = {};
    const matches = [...input.matchAll(PLACEHOLDER_RE)];

    if (matches.length === 0) return input;

    // Fetch unique secret IDs
    const uniqueIds = [...new Set(matches.map(m => m[1]))];
    for (const id of uniqueIds) {
        process.stderr.write(`Fetching secret ${id}... `);
        const secret = await getSecret(baseUrl, apiToken, parseInt(id));
        cache[id] = parseItems(secret);
        process.stderr.write('OK\n');
    }

    // Replace placeholders
    return input.replace(PLACEHOLDER_RE, (match, id, field) => {
        const items = cache[id];
        if (!items) return match;
        const value = items[field.toLowerCase()];
        if (value === undefined) {
            process.stderr.write(`WARN: field "${field}" not found in secret ${id}\n`);
            return match;
        }
        return value;
    });
}

async function resolveFile(baseUrl, apiToken, inputPath, outputPath) {
    const input = fs.readFileSync(inputPath, 'utf8');
    const resolved = await resolve(baseUrl, apiToken, input);

    if (outputPath) {
        fs.writeFileSync(outputPath, resolved);
        console.error(`Written to ${outputPath}`);
    } else {
        process.stdout.write(resolved);
    }
}

async function resolveStdin(baseUrl, apiToken) {
    const chunks = [];
    for await (const chunk of process.stdin) chunks.push(chunk);
    const input = Buffer.concat(chunks).toString('utf8');
    const resolved = await resolve(baseUrl, apiToken, input);
    process.stdout.write(resolved);
}

module.exports = { resolve, resolveFile, resolveStdin };
