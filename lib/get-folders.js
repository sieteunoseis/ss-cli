const { makeClient } = require('./client');

async function getFolders(baseUrl, apiToken, page = 1, pageSize = 25) {
    const client = makeClient(baseUrl, apiToken);
    const skip = (page - 1) * pageSize;
    return client.get(`/api/v1/folders?take=${pageSize}&skip=${skip}`);
}

async function listAllFolders(baseUrl, apiToken) {
    const pageSize = 25;
    let currentPage = 1;
    let allFolders = [];

    while (true) {
        const page = await getFolders(baseUrl, apiToken, currentPage, pageSize);
        allFolders = [...allFolders, ...page.records];
        if (allFolders.length >= page.total || page.records.length === 0) break;
        currentPage++;
    }

    return allFolders;
}

module.exports = { getFolders, listAllFolders };
