const { makeClient } = require('./client');

async function getTemplates(baseUrl, apiToken, page = 1, pageSize = 25) {
    const client = makeClient(baseUrl, apiToken);
    const skip = (page - 1) * pageSize;
    return client.get(`/api/v1/secret-templates?take=${pageSize}&skip=${skip}`);
}

async function findTemplateByName(baseUrl, apiToken, templateName) {
    let currentPage = 1;
    const pageSize = 25;

    while (true) {
        const response = await getTemplates(baseUrl, apiToken, currentPage, pageSize);
        const template = response.records.find(t => t.name.toLowerCase() === templateName.toLowerCase());
        if (template) return template;
        if (currentPage * pageSize >= response.total) break;
        currentPage++;
    }
    return null;
}

async function listAllTemplates(baseUrl, apiToken) {
    const pageSize = 25;
    let currentPage = 1;
    let allTemplates = [];

    while (true) {
        const page = await getTemplates(baseUrl, apiToken, currentPage, pageSize);
        allTemplates = [...allTemplates, ...page.records];
        if (allTemplates.length >= page.total || page.records.length === 0) break;
        currentPage++;
    }

    return allTemplates;
}

module.exports = { getTemplates, listAllTemplates, findTemplateByName };
