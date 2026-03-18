/**
 * client.js
 * Shared Secret Server HTTP client with legacy SSL support.
 */

const https = require('https');
const nodeFetch = require('node-fetch');

const agent = new https.Agent({
    rejectUnauthorized: false,
    secureOptions: require('constants').SSL_OP_LEGACY_SERVER_CONNECT
});

function formatUrl(baseUrl) {
    baseUrl = baseUrl.replace(/\/+$/, '');
    if (!baseUrl.startsWith('http://') && !baseUrl.startsWith('https://')) {
        baseUrl = 'https://' + baseUrl;
    }
    return baseUrl;
}

function makeClient(baseUrl, apiToken) {
    baseUrl = formatUrl(baseUrl);
    const headers = {
        'Authorization': `Bearer ${apiToken}`,
        'Content-Type': 'application/json'
    };

    async function request(method, path, body) {
        const url = `${baseUrl}${path}`;
        const options = { method, headers, agent };
        if (body) options.body = JSON.stringify(body);

        const r = await nodeFetch(url, options);
        if (!r.ok) {
            const text = await r.text();
            throw new Error(`HTTP ${r.status} ${r.statusText} — ${text.substring(0, 200)}`);
        }
        return r.json();
    }

    return {
        get:    (path)         => request('GET',    path),
        post:   (path, body)   => request('POST',   path, body),
        put:    (path, body)   => request('PUT',    path, body),
        patch:  (path, body)   => request('PATCH',  path, body),
        delete: (path)         => request('DELETE', path),
        baseUrl,
    };
}

async function validateToken(baseUrl, apiToken) {
    try {
        const client = makeClient(baseUrl, apiToken);
        await client.get('/api/v1/folders?take=1');
        return true;
    } catch {
        return false;
    }
}

module.exports = { makeClient, formatUrl, validateToken, agent };
