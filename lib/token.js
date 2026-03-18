/**
 * lib/token.js
 * Token cache: read/write ~/.config/ss/token.json
 */

const fs = require('fs');
const path = require('path');
const { CONFIG_DIR } = require('./config');

const TOKEN_FILE = path.join(CONFIG_DIR, 'token.json');
const TOKEN_TTL_MIN = 55; // cache for 55 min (tokens last ~20 min from SS, but browser tokens last longer)

function saveToken(token, ttlMinutes) {
    const ttl = ttlMinutes || TOKEN_TTL_MIN;
    const data = {
        token,
        expires_at: new Date(Date.now() + ttl * 60 * 1000).toISOString(),
        saved_at: new Date().toISOString()
    };
    fs.mkdirSync(CONFIG_DIR, { recursive: true });
    fs.writeFileSync(TOKEN_FILE, JSON.stringify(data, null, 2) + '\n', { mode: 0o600 });
}

function getToken() {
    try {
        const data = JSON.parse(fs.readFileSync(TOKEN_FILE, 'utf8'));
        if (new Date(data.expires_at) <= new Date()) return null;
        return data.token;
    } catch {
        return null;
    }
}

function requireToken() {
    const token = getToken();
    if (!token) {
        console.error('Token expired or not found. Run: ss-cli login');
        process.exit(1);
    }
    return token;
}

function tokenStatus() {
    try {
        const data = JSON.parse(fs.readFileSync(TOKEN_FILE, 'utf8'));
        const expiresAt = new Date(data.expires_at);
        const now = new Date();
        const minutesLeft = Math.round((expiresAt - now) / 60000);
        return {
            valid: expiresAt > now,
            expiresAt: data.expires_at,
            savedAt: data.saved_at,
            minutesLeft: Math.max(0, minutesLeft)
        };
    } catch {
        return { valid: false, expiresAt: null, savedAt: null, minutesLeft: 0 };
    }
}

module.exports = { TOKEN_FILE, saveToken, getToken, requireToken, tokenStatus };
