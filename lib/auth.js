/**
 * lib/auth.js
 * OAuth2 password grant with OTP header for Duo/TOTP 2FA.
 */

const https = require('https');
const nodeFetch = require('node-fetch');
const readline = require('readline');

const agent = new https.Agent({
    rejectUnauthorized: false,
    secureOptions: require('constants').SSL_OP_LEGACY_SERVER_CONNECT
});

function ask(rl, question, hidden) {
    return new Promise((resolve) => {
        if (hidden) {
            // Hide input for password
            process.stderr.write(question);
            const stdin = process.stdin;
            const wasRaw = stdin.isRaw;
            stdin.setRawMode(true);
            stdin.resume();
            stdin.setEncoding('utf8');
            let input = '';
            const onData = (ch) => {
                if (ch === '\n' || ch === '\r' || ch === '\u0004') {
                    stdin.setRawMode(wasRaw);
                    stdin.removeListener('data', onData);
                    stdin.pause();
                    process.stderr.write('\n');
                    resolve(input);
                } else if (ch === '\u0003') {
                    process.exit(130);
                } else if (ch === '\u007F' || ch === '\b') {
                    input = input.slice(0, -1);
                } else {
                    input += ch;
                }
            };
            stdin.on('data', onData);
        } else {
            rl.question(question, resolve);
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
    const rl = readline.createInterface({ input: process.stdin, output: process.stderr });

    const url = config.url;
    if (!url) {
        rl.close();
        console.error('Error: URL not configured. Run: ss-cli config set url <Secret Server URL>');
        process.exit(1);
    }

    const username = config.username || await ask(rl, 'Username: ');
    const domain = config.domain || await ask(rl, 'Domain (blank for default): ');
    const password = await ask(rl, 'Password: ', true);
    const otp = await ask(rl, 'Duo TOTP code: ');

    rl.close();

    const data = await oauth2Login({ url, username, password, domain: domain || undefined, otp: otp || undefined });
    return data;
}

module.exports = { oauth2Login, promptLogin };
