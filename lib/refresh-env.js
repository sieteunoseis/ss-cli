/**
 * lib/refresh-env.js
 * Pull credentials from Secret Server and update an env file.
 * Uses an external JSON map file instead of hardcoded secret IDs.
 */

const fs = require('fs');
const { makeClient } = require('./client');
const { getSecret, parseItems } = require('./get-secret');

async function refreshEnv(baseUrl, apiToken, envPath, mapFile) {
    const map = JSON.parse(fs.readFileSync(mapFile, 'utf8'));
    let content = fs.readFileSync(envPath, 'utf8');

    let totalUpdated = 0;
    let totalSkipped = 0;
    let errors = 0;

    for (const entry of map) {
        process.stdout.write(`[${entry.secretId}] ${entry.name || 'secret'}... `);
        try {
            const secret = await getSecret(baseUrl, apiToken, entry.secretId);
            const items = parseItems(secret);

            for (const [field, envVar] of Object.entries(entry.fields)) {
                let value = items[field];

                // Support transform functions in map (e.g., extract hostname from URL)
                if (entry.transforms && entry.transforms[field]) {
                    const transform = entry.transforms[field];
                    if (transform === 'hostname') {
                        value = new URL(value).hostname;
                    } else if (transform === 'dbname') {
                        value = new URL(value).pathname.replace('/', '');
                    }
                }

                if (value === undefined) {
                    console.log(`  WARN: field "${field}" not found in secret ${entry.secretId}`);
                    totalSkipped++;
                    continue;
                }

                const regex = new RegExp(`^(${envVar}=).*$`, 'm');
                if (regex.test(content)) {
                    content = content.replace(regex, `$1${value}`);
                    totalUpdated++;
                } else {
                    console.log(`  WARN: ${envVar} not found in env file — skipping`);
                    totalSkipped++;
                }
            }
            console.log('OK');
        } catch (e) {
            console.log(`ERROR: ${e.message}`);
            errors++;
        }
    }

    fs.writeFileSync(envPath, content);
    console.log(`\nDone. ${totalUpdated} updated, ${totalSkipped} skipped, ${errors} errors.`);
    return { totalUpdated, totalSkipped, errors };
}

module.exports = { refreshEnv };
