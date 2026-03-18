const { makeClient } = require('./client');

async function createSecret(baseUrl, apiToken, secretData) {
    const client = makeClient(baseUrl, apiToken);
    return client.post('/api/v1/secrets', {
        name: secretData.name,
        secretTemplateId: secretData.secretTemplateId,
        folderId: secretData.folderId,
        siteId: secretData.siteId || 1,
        items: secretData.items
    });
}


module.exports = { createSecret };
