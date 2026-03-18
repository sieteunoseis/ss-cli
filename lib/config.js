/**
 * lib/config.js
 * Read/write ~/.config/ss/config.json
 */

const fs = require('fs');
const path = require('path');
const os = require('os');

const CONFIG_DIR = path.join(os.homedir(), '.config', 'ss');
const CONFIG_FILE = path.join(CONFIG_DIR, 'config.json');

function ensureDir() {
    fs.mkdirSync(CONFIG_DIR, { recursive: true });
}

function getConfig() {
    try {
        return JSON.parse(fs.readFileSync(CONFIG_FILE, 'utf8'));
    } catch {
        return {};
    }
}

function saveConfig(config) {
    ensureDir();
    fs.writeFileSync(CONFIG_FILE, JSON.stringify(config, null, 2) + '\n');
}

function setConfig(key, value) {
    const config = getConfig();
    // Try to parse numbers
    if (/^\d+$/.test(value)) value = parseInt(value, 10);
    config[key] = value;
    saveConfig(config);
}

function getConfigValue(key) {
    return getConfig()[key];
}

function requireConfigValue(key, flag) {
    const val = getConfigValue(key);
    if (val === undefined || val === null) {
        const hint = flag ? ` (or pass ${flag})` : '';
        console.error(`Error: "${key}" not configured. Run: ss-cli config set ${key} <value>${hint}`);
        process.exit(1);
    }
    return val;
}

module.exports = { CONFIG_DIR, CONFIG_FILE, getConfig, saveConfig, setConfig, getConfigValue, requireConfigValue };
