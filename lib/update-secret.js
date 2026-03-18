/**
 * update-secret.js
 * Update one or more field values on an existing secret.
 *
 * Usage:
 *   SECRET_SERVER_URL=... SECRET_SERVER_TOKEN=... SECRET_ID=21908 FIELD_NAME=password FIELD_VALUE=newpass node update-secret.js
 */

const { makeClient } = require('./client');
const { getSecret } = require('./get-secret');

async function updateSecret(baseUrl, apiToken, secretId, fields) {
    const client = makeClient(baseUrl, apiToken);

    // Fetch current secret to get full items array
    const secret = await getSecret(baseUrl, apiToken, secretId);

    // Merge updates into existing items
    const updatedItems = secret.items.map(item => {
        const fieldKey = item.fieldName.toLowerCase();
        if (fields[fieldKey] !== undefined) {
            return { ...item, itemValue: fields[fieldKey] };
        }
        return item;
    });

    // Check for unknown field names
    const knownFields = secret.items.map(i => i.fieldName.toLowerCase());
    for (const key of Object.keys(fields)) {
        if (!knownFields.includes(key)) {
            throw new Error(`Field "${key}" not found on secret ${secretId}. Available: ${knownFields.join(', ')}`);
        }
    }

    return client.put(`/api/v1/secrets/${secretId}`, {
        ...secret,
        items: updatedItems
    });
}


module.exports = { updateSecret };
