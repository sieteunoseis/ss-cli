/**
 * lib/windmill-sync.js
 * Sync Windmill workspace variables to Secret Server.
 * No hardcoded folder/template IDs — passed via args or config.
 */

process.env.NODE_TLS_REJECT_UNAUTHORIZED = '0';

const https = require('https');
const http = require('http');
const nodeFetch = require('node-fetch');
const { makeClient } = require('./client');
const { searchSecrets } = require('./search-secrets');
const { createSecret } = require('./create-secret');
const { updateSecret } = require('./update-secret');

async function syncWindmillToSS({ ssBaseUrl, ssToken, wmBaseUrl, wmToken, workspace, folderId, templateId, dryRun, skipSecrets }) {

    async function wmGet(path) {
        const isHttps = wmBaseUrl.startsWith('https');
        const agent = new (isHttps ? https : http).Agent({ rejectUnauthorized: false });
        const url = `${wmBaseUrl.replace(/\/$/, '')}${path}`;
        const res = await nodeFetch(url, {
            headers: { Authorization: `Bearer ${wmToken}` },
            agent
        });
        if (!res.ok) {
            const body = await res.text();
            throw new Error(`Windmill GET ${path} → ${res.status}: ${body}`);
        }
        const ct = res.headers.get('content-type') || '';
        return ct.includes('application/json') ? res.json() : res.text();
    }

    console.log(`Fetching variables from workspace "${workspace}"...`);
    const variables = await wmGet(`/api/w/${workspace}/variables/list`);
    console.log(`  Found ${variables.length} variable(s)\n`);

    let created = 0, updated = 0, skipped = 0, errors = 0;

    for (const v of variables) {
        const secretName = `Windmill: ${v.path}`;

        let value = v.value;
        if (value === null || value === undefined) {
            if (skipSecrets) {
                console.log(`  SKIP  ${v.path}  (secret variable)`);
                skipped++;
                continue;
            }
            try {
                value = await wmGet(`/api/w/${workspace}/variables/get_value/${v.path}`);
            } catch (err) {
                console.error(`  ERROR ${v.path}  Could not fetch value: ${err.message}`);
                errors++;
                continue;
            }
        }

        if (dryRun) {
            console.log(`  [DRY]  ${secretName}`);
            continue;
        }

        try {
            const existing = await searchSecrets(ssBaseUrl, ssToken, secretName, folderId);
            const match = existing.find(s => s.name === secretName);

            const fields = {
                url:      `${wmBaseUrl}/variables/${v.path}`,
                username: v.path,
                password: String(value),
                notes:    v.description || ''
            };

            if (match) {
                await updateSecret(ssBaseUrl, ssToken, match.id, fields);
                console.log(`  UPDATE [${match.id}] ${secretName}`);
                updated++;
            } else {
                const result = await createSecret(ssBaseUrl, ssToken, {
                    name:             secretName,
                    secretTemplateId: templateId,
                    folderId:         folderId,
                    siteId:           1,
                    items: [
                        { fieldName: 'url',      itemValue: fields.url },
                        { fieldName: 'username', itemValue: fields.username },
                        { fieldName: 'password', itemValue: fields.password },
                        { fieldName: 'notes',    itemValue: fields.notes }
                    ]
                });
                console.log(`  CREATE [${result.id}] ${secretName}`);
                created++;
            }
        } catch (err) {
            console.error(`  ERROR  ${secretName}: ${err.message}`);
            errors++;
        }
    }

    console.log(`\nDone. Created: ${created}  Updated: ${updated}  Skipped: ${skipped}  Errors: ${errors}`);
    return { created, updated, skipped, errors };
}

module.exports = { syncWindmillToSS };
