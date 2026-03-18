const { makeClient } = require('./client');

async function getSecret(baseUrl, apiToken, secretId) {
    const client = makeClient(baseUrl, apiToken);
    return client.get(`/api/v1/secrets/${secretId}`);
}

function parseItems(secret) {
    const items = {};
    secret.items.forEach(item => { items[item.fieldName.toLowerCase()] = item.itemValue; });
    return items;
}


module.exports = { getSecret, parseItems };
