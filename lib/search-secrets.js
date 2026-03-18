const { makeClient } = require('./client');

async function searchSecrets(baseUrl, apiToken, searchTerm, folderId = null, templateId = null, pageSize = 50) {
    const client = makeClient(baseUrl, apiToken);
    let allRecords = [];
    let skip = 0;

    while (true) {
        let path = `/api/v1/secrets?take=${pageSize}&skip=${skip}&searchText=${encodeURIComponent(searchTerm)}`;
        if (folderId) path += `&folderId=${folderId}`;
        if (templateId) path += `&secretTemplateId=${templateId}`;

        const data = await client.get(path);
        allRecords = [...allRecords, ...data.records];

        if (allRecords.length >= data.total || data.records.length === 0) break;
        skip += pageSize;
    }

    return allRecords;
}

module.exports = { searchSecrets };
