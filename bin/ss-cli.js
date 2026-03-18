#!/usr/bin/env node

process.env.NODE_TLS_REJECT_UNAUTHORIZED = '0';

const { Command } = require('commander');
const { getConfig, setConfig, getConfigValue, requireConfigValue } = require('../lib/config');
const { saveToken, requireToken, tokenStatus } = require('../lib/token');
const { oauth2Login, promptLogin } = require('../lib/auth');
const { validateToken } = require('../lib/client');
const { getSecret, parseItems } = require('../lib/get-secret');
const { searchSecrets } = require('../lib/search-secrets');
const { createSecret } = require('../lib/create-secret');
const { updateSecret } = require('../lib/update-secret');
const { listAllTemplates, findTemplateByName } = require('../lib/get-templates');
const { listAllFolders } = require('../lib/get-folders');
const { refreshEnv } = require('../lib/refresh-env');
const { syncWindmillToSS } = require('../lib/windmill-sync');

const program = new Command();
program
    .name('ss-cli')
    .description('Secret Server CLI')
    .version(require('../package.json').version);

// --- config ---
const configCmd = program.command('config').description('Manage configuration');

configCmd
    .command('set <key> <value>')
    .description('Set a config value')
    .action((key, value) => {
        setConfig(key, value);
        console.log(`${key} = ${getConfigValue(key)}`);
    });

configCmd
    .command('get [key]')
    .description('Get one or all config values')
    .action((key) => {
        if (key) {
            const val = getConfigValue(key);
            if (val === undefined) { console.error(`"${key}" not set`); process.exit(1); }
            console.log(val);
        } else {
            console.log(JSON.stringify(getConfig(), null, 2));
        }
    });

configCmd
    .command('show')
    .description('Show all config values')
    .action(() => {
        console.log(JSON.stringify(getConfig(), null, 2));
    });

// --- login ---
program
    .command('login')
    .description('Authenticate with Secret Server')
    .option('--token <token>', 'Paste an existing API token (skip OAuth2)')
    .option('--username <user>', 'Username for OAuth2 login')
    .option('--domain <domain>', 'Domain for OAuth2 login')
    .action(async (opts) => {
        const url = getConfigValue('url');

        if (opts.token) {
            // Manual token paste
            if (url) {
                process.stdout.write('Validating token... ');
                const valid = await validateToken(url, opts.token);
                if (!valid) { console.log('INVALID'); process.exit(1); }
                console.log('OK');
            }
            saveToken(opts.token);
            console.log('Token saved (expires in 55 min).');
            return;
        }

        // OAuth2 login
        if (!url) {
            console.error('Error: URL not configured. Run: ss-cli config set url <Secret Server URL>');
            process.exit(1);
        }

        try {
            const config = {
                url,
                username: opts.username || getConfigValue('username'),
                domain: opts.domain || getConfigValue('domain')
            };
            const data = await promptLogin(config);
            const ttl = data.expires_in ? Math.floor(data.expires_in / 60) : 55;
            saveToken(data.access_token, ttl);
            console.log(`Authenticated. Token saved (expires in ${ttl} min).`);
        } catch (err) {
            console.error(`Login failed: ${err.message}`);
            process.exit(1);
        }
    });

// --- token-status ---
program
    .command('token-status')
    .description('Show token validity and expiry')
    .action(() => {
        const status = tokenStatus();
        if (!status.valid) {
            console.log('No valid token. Run: ss-cli login');
            process.exit(1);
        }
        console.log(`Valid:   ${status.valid}`);
        console.log(`Expires: ${status.expiresAt}`);
        console.log(`Left:    ${status.minutesLeft} min`);
    });

// --- get ---
program
    .command('get <id>')
    .description('Get a secret by ID')
    .option('--format <fmt>', 'Output format: table or json', 'table')
    .action(async (id, opts) => {
        const url = requireConfigValue('url');
        const token = requireToken();
        const secret = await getSecret(url, token, parseInt(id));

        if (opts.format === 'json') {
            console.log(JSON.stringify(secret, null, 2));
        } else {
            console.log(`ID:       ${secret.id}`);
            console.log(`Name:     ${secret.name}`);
            console.log(`Template: ${secret.secretTemplateName} (${secret.secretTemplateId})`);
            console.log(`Folder:   ${secret.folderName} (${secret.folderId})`);
            console.log('---');
            secret.items.forEach(i => console.log(`${i.fieldName}: ${i.itemValue}`));
        }
    });

// --- search ---
program
    .command('search <term>')
    .description('Search secrets by name')
    .option('--folder <id>', 'Filter by folder ID')
    .action(async (term, opts) => {
        const url = requireConfigValue('url');
        const token = requireToken();
        const folderId = opts.folder ? parseInt(opts.folder) : null;
        const records = await searchSecrets(url, token, term, folderId);

        if (records.length === 0) {
            console.log(`No secrets found matching "${term}"`);
            return;
        }
        console.log(`Found ${records.length} secret(s):\n`);
        records.forEach(s => console.log(`  [${s.id}] ${s.name}  (folder: ${s.folderName || 'N/A'})`));
    });

// --- create ---
program
    .command('create')
    .description('Create a new secret')
    .requiredOption('--name <name>', 'Secret name')
    .option('--template <id>', 'Template ID')
    .option('--folder <id>', 'Folder ID')
    .option('--field <key=val>', 'Field value (repeatable)', collect, [])
    .action(async (opts) => {
        const url = requireConfigValue('url');
        const token = requireToken();
        const templateId = parseInt(opts.template || requireConfigValue('defaultTemplate', '--template'));
        const folderId = parseInt(opts.folder || requireConfigValue('defaultFolder', '--folder'));

        const items = opts.field.map(f => {
            const [key, ...rest] = f.split('=');
            return { fieldName: key, itemValue: rest.join('=') };
        });

        const result = await createSecret(url, token, {
            name: opts.name,
            secretTemplateId: templateId,
            folderId: folderId,
            siteId: 1,
            items
        });
        console.log(`Created: ${result.name} (ID: ${result.id})`);
    });

// --- update ---
program
    .command('update <id>')
    .description('Update fields on an existing secret')
    .option('--field <key=val>', 'Field to update (repeatable)', collect, [])
    .action(async (id, opts) => {
        const url = requireConfigValue('url');
        const token = requireToken();

        const fields = {};
        opts.field.forEach(f => {
            const [key, ...rest] = f.split('=');
            fields[key.toLowerCase()] = rest.join('=');
        });

        if (Object.keys(fields).length === 0) {
            console.error('No fields specified. Use --field key=value');
            process.exit(1);
        }

        const result = await updateSecret(url, token, parseInt(id), fields);
        console.log(`Updated: ${result.name} (ID: ${result.id})`);
    });

// --- templates ---
program
    .command('templates')
    .description('List secret templates')
    .option('--name <filter>', 'Filter by name')
    .action(async (opts) => {
        const url = requireConfigValue('url');
        const token = requireToken();

        if (opts.name) {
            const t = await findTemplateByName(url, token, opts.name);
            if (t) {
                console.log(`${t.name} (ID: ${t.id})`);
            } else {
                console.log(`Template "${opts.name}" not found`);
            }
        } else {
            const templates = await listAllTemplates(url, token);
            templates.forEach(t => console.log(`  [${t.id}] ${t.name}`));
            console.log(`\n${templates.length} template(s)`);
        }
    });

// --- version (server) ---
program
    .command('server-version')
    .description('Show Secret Server API version')
    .action(async () => {
        const url = requireConfigValue('url');
        const token = requireToken();
        const { makeClient } = require('../lib/client');
        const client = makeClient(url, token);
        const data = await client.get('/api/v1/version');
        console.log(data.model ? `Secret Server ${data.model.version}` : JSON.stringify(data, null, 2));
    });

// --- folders ---
program
    .command('folders')
    .description('List folders')
    .action(async () => {
        const url = requireConfigValue('url');
        const token = requireToken();
        const folders = await listAllFolders(url, token);
        folders.forEach(f => console.log(`  [${f.id}] ${f.folderName}`));
        console.log(`\n${folders.length} folder(s)`);
    });

// --- refresh-env ---
program
    .command('refresh-env')
    .description('Sync Secret Server secrets to an env file')
    .option('--env-file <path>', 'Path to env file')
    .option('--map-file <path>', 'Path to JSON map file')
    .action(async (opts) => {
        const url = requireConfigValue('url');
        const token = requireToken();
        const envFile = opts.envFile || requireConfigValue('defaultEnvFile', '--env-file');
        const mapFile = opts.mapFile || requireConfigValue('envMapFile', '--map-file');

        console.log(`Refreshing ${envFile} from Secret Server...\n`);
        await refreshEnv(url, token, envFile, mapFile);
    });

// --- windmill-sync ---
program
    .command('windmill-sync')
    .description('Sync Windmill variables to Secret Server')
    .option('--folder <id>', 'SS folder ID')
    .option('--template <id>', 'SS template ID')
    .option('--windmill-url <url>', 'Windmill base URL')
    .option('--windmill-workspace <ws>', 'Windmill workspace name')
    .option('--windmill-token <token>', 'Windmill API token')
    .option('--dry-run', 'Preview without making changes')
    .option('--skip-secrets', 'Skip secret variables')
    .action(async (opts) => {
        const url = requireConfigValue('url');
        const token = requireToken();

        const folderId = parseInt(opts.folder || requireConfigValue('defaultFolder', '--folder'));
        const templateId = parseInt(opts.template || requireConfigValue('defaultTemplate', '--template'));
        const wmUrl = opts.windmillUrl || process.env.WINDMILL_URL || getConfigValue('windmillUrl');
        const wmWorkspace = opts.windmillWorkspace || process.env.WINDMILL_WORKSPACE || getConfigValue('windmillWorkspace');
        const wmToken = opts.windmillToken || process.env.WINDMILL_TOKEN || getConfigValue('windmillToken');

        if (!wmUrl) { console.error('Error: Windmill URL required. Use --windmill-url, WINDMILL_URL env var, or: ss-cli config set windmillUrl <url>'); process.exit(1); }
        if (!wmWorkspace) { console.error('Error: Windmill workspace required. Use --windmill-workspace, WINDMILL_WORKSPACE env var, or: ss-cli config set windmillWorkspace <name>'); process.exit(1); }
        if (!wmToken) { console.error('Error: Windmill token required. Use --windmill-token, WINDMILL_TOKEN env var, or: ss-cli config set windmillToken <token>'); process.exit(1); }

        await syncWindmillToSS({
            ssBaseUrl: url,
            ssToken: token,
            wmBaseUrl: wmUrl,
            wmToken: wmToken,
            workspace: wmWorkspace,
            folderId,
            templateId,
            dryRun: opts.dryRun || false,
            skipSecrets: opts.skipSecrets || false
        });
    });

// --- helper ---
function collect(val, arr) {
    arr.push(val);
    return arr;
}

program.parseAsync(process.argv).catch(err => {
    console.error(err.message);
    process.exit(1);
});
