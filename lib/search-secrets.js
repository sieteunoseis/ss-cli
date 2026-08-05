const { makeClient } = require('./client');

async function searchSecrets(baseUrl, apiToken, searchTerm, folderId = null, templateId = null, pageSize = 50, includeSubFolders = false) {
    const client = makeClient(baseUrl, apiToken);
    let allRecords = [];
    let skip = 0;

    while (true) {
        let path = `/api/v1/secrets?take=${pageSize}&skip=${skip}`;
        if (searchTerm) path += `&filter.searchText=${encodeURIComponent(searchTerm)}`;
        if (folderId) path += `&filter.folderId=${folderId}`;
        if (folderId && includeSubFolders) path += `&filter.includeSubFolders=true`;
        if (templateId) path += `&filter.secretTemplateId=${templateId}`;

        const data = await client.get(path);
        allRecords = [...allRecords, ...data.records];

        if (allRecords.length >= data.total || data.records.length === 0) break;
        skip += pageSize;
    }

    return allRecords;
}

module.exports = { searchSecrets };
