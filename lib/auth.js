/**
 * lib/auth.js
 * OAuth2 password grant with OTP header for TOTP 2FA.
 */

const https = require('https');
const nodeFetch = require('node-fetch');
const readline = require('readline');

const agent = new https.Agent({
    rejectUnauthorized: false,
    secureOptions: require('constants').SSL_OP_LEGACY_SERVER_CONNECT
});

function ask(question, hidden) {
    return new Promise((resolve) => {
        if (hidden) {
            process.stderr.write(question);
            const stdin = process.stdin;
            stdin.setRawMode(true);
            stdin.resume();
            stdin.setEncoding('utf8');
            let input = '';
            const onData = (ch) => {
                if (ch === '\n' || ch === '\r' || ch === '\u0004') {
                    stdin.removeListener('data', onData);
                    stdin.setRawMode(false);
                    stdin.pause();
                    process.stderr.write('\n');
                    resolve(input);
                } else if (ch === '\u0003') {
                    stdin.setRawMode(false);
                    process.exit(130);
                } else if (ch === '\u007F' || ch === '\b') {
                    input = input.slice(0, -1);
                } else {
                    input += ch;
                }
            };
            stdin.on('data', onData);
        } else {
            const rl = readline.createInterface({ input: process.stdin, output: process.stderr });
            rl.question(question, (answer) => {
                rl.close();
                resolve(answer);
            });
        }
    });
}

async function oauth2Login({ url, username, password, domain, otp }) {
    const tokenUrl = `${url.replace(/\/+$/, '')}/oauth2/token`;

    const headers = { 'Content-Type': 'application/x-www-form-urlencoded' };
    if (otp) headers['OTP'] = otp;

    let body = `grant_type=password&username=${encodeURIComponent(username)}&password=${encodeURIComponent(password)}`;
    if (domain) body += `&domain=${encodeURIComponent(domain)}`;

    const res = await nodeFetch(tokenUrl, { method: 'POST', agent, headers, body });
    const data = await res.json();

    if (!res.ok) {
        throw new Error(data.error || `HTTP ${res.status}`);
    }

    return data;
}

async function promptLogin(config) {
    const url = config.url;
    if (!url) {
        console.error('Error: URL not configured. Run: ss-cli config set url <Secret Server URL>');
        process.exit(1);
    }

    const username = config.username || await ask('Username: ');
    const domain = config.domain || await ask('Domain (blank for default): ');
    const password = await ask('Password: ', true);
    const otp = await ask('OTP (TOTP code or "push"): ');

    const data = await oauth2Login({ url, username, password, domain: domain || undefined, otp: otp || undefined });
    return data;
}

module.exports = { oauth2Login, promptLogin };
