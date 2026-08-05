# ssh-list Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add `ss-cli ssh-list` — an arrow-key picker over SSH-reachable servers (cached hosts by default, `--all` for every secret in the configured folder/templates) that connects immediately on selection.

**Architecture:** Extract the folder/template secret-query logic already inside `resolveSecret` (`lib/ssh.js`) into a reusable `searchSshSecrets` helper. Build a new `runSshList` orchestration function on top of it plus the existing `ssh-cache.json` reader, using `enquirer`'s `Select` prompt for the interactive menu and falling back to a plain printed list on non-TTY stdout/stdin. Wire it up as a new flat `ssh-list` command in `bin/ss-cli.js`, reusing `sshFromSecret` for the actual connection so no connection logic is duplicated.

**Tech Stack:** Node.js (CommonJS), commander (existing CLI framework), enquirer (new dependency, `Select` prompt), no test framework (this repo has none — verification is manual, run against the real Secret Server instance already configured on this machine).

## Global Constraints

- Do not change the existing `ss-cli ssh <target>` or `ss-cli ssh-copy-id <target>` invocation or observable behavior.
- No new config keys — reuse `sshFolder`, `sshTemplates`, `sshDomain`, `sshUsername`.
- `enquirer` is the only new dependency (version `^2.4.1`, confirmed CommonJS-compatible, 4 packages total including transitive deps).
- Bump `package.json` version `1.8.2` → `1.9.0` (new backwards-compatible feature, per this repo's SemVer convention in `~/development/CLAUDE.md`).
- This repo has no lint tooling configured (no eslint config, no `scripts` in `package.json`) — do not add one as part of this change.
- Follow existing code style in `lib/ssh.js` and `bin/ss-cli.js`: 4-space indent, no semicolon-free style, `console.error` for status/progress messages, `console.log` for final structured output.

---

### Task 1: Fix `searchSecrets` to omit empty search filter and support subfolder recursion

**Background confirmed live against this machine's real Secret Server:** `filter.folderId`
alone does NOT include subfolders — a test folder went from `total: 2` (direct only) to
`total: 1320` with `filter.includeSubFolders=true` added. `sshFolder` is meant to be
pointed at a container folder with SSH secrets organized in subfolders underneath, so
the SSH-specific call sites (Task 2) need this flag. The general `ss-cli search --folder`
command and `windmill-sync`'s exact-folder existence check must NOT change — recursing
there could make windmill-sync's duplicate-secret detection match a secret in an
unrelated subfolder instead of creating a new one in the exact folder requested. So this
is a new opt-in parameter, defaulted off, not a global behavior change.

**Files:**
- Modify: `lib/search-secrets.js`

**Interfaces:**
- Consumes: nothing new.
- Produces: `searchSecrets(baseUrl, apiToken, searchTerm, folderId, templateId, pageSize, includeSubFolders)` —
  1. treats a falsy `searchTerm` (`''`, `null`, `undefined`) as "no text filter" instead of sending `filter.searchText=` (empty string) to the API.
  2. new 7th parameter `includeSubFolders = false` (default preserves current behavior for every existing caller); when truthy, adds `filter.includeSubFolders=true` to the query, only meaningful when `folderId` is also set.

- [ ] **Step 1: Make the change**

Replace the full contents of `lib/search-secrets.js`:

```js
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
```

- [ ] **Step 2: Verify no syntax errors**

Run: `node -e "require('./lib/search-secrets.js'); console.log('ok')"` from the repo root.
Expected: prints `ok`.

- [ ] **Step 3: Manual verification against the real Secret Server**

This repo has no test framework or mocks — verification is against the real, already-configured Secret Server instance on this machine. Use a folder ID known to have subfolders (folder `3473` was confirmed live to have 19 subfolders and 1320 secrets recursively vs. 2 directly — use that same folder here, or substitute another folder ID you know has children via `ss-cli folders`).

Run: `node -e "
const { searchSecrets } = require('./lib/search-secrets');
const { getConfigValue } = require('./lib/config');
const { requireToken } = require('./lib/token');
(async () => {
  const url = getConfigValue('url');
  const token = requireToken();
  const flat = await searchSecrets(url, token, '', 3473);
  const recursive = await searchSecrets(url, token, '', 3473, null, 50, true);
  console.log('flat count:', flat.length, '| recursive count:', recursive.length);
})();
"`

If the stored token has expired, run `ss-cli login` first, then retry.

Expected: `recursive count` is substantially larger than `flat count` (matching the live totals of 2 vs 1320 confirmed for folder 3473), and `flat count` matches what today's behavior already returns — confirming the new parameter is additive and off-by-default.

- [ ] **Step 4: Commit**

```bash
cd ~/development/ss-cli
git add lib/search-secrets.js
git commit -m "Add includeSubFolders option and omit empty filter.searchText"
```

---

### Task 2: Extract shared SSH secret search helpers in `lib/ssh.js`

**Files:**
- Modify: `lib/ssh.js:42-124` (the `resolveSecret` function)

**Interfaces:**
- Consumes: `searchSecrets(baseUrl, apiToken, searchTerm, folderId, templateId, pageSize, includeSubFolders)` (from Task 1, already imported at the top of `lib/ssh.js` as `const { searchSecrets } = require('./search-secrets');` — no import change needed; Task 1 added the new 7th parameter).
- Produces (new, internal to `lib/ssh.js`, not yet exported):
  - `async function searchSshSecrets(baseUrl, apiToken, searchTerm = '')` → `Promise<Array<{id, name, ...}>>` — queries `sshFolder`/`sshTemplates` scope, deduped by `id`. The `sshFolder` branch passes `includeSubFolders: true` (see Step 2) so secrets nested in subfolders under `sshFolder` are included — confirmed live that Secret Server's folder filter does not recurse by default. Does NOT check whether the scope is configured; returns `[]` if `templateIds` is empty and `folderId` is null.
  - `async function listAllSshSecrets(baseUrl, apiToken)` → `Promise<Array<{id, name, ...}>>` — throws if neither `sshFolder` nor `sshTemplates` is configured, throws if the query returns zero results, otherwise returns the same array `searchSshSecrets('')` would.
- `resolveSecret`'s return value and side effects are unchanged for every input EXCEPT that its `sshFolder`-scoped branch now also matches secrets in subfolders under `sshFolder` (previously it silently missed them) — an intentional behavior improvement decided alongside this task, not a regression. The single-match/exact-match/list-options logic downstream of the search is untouched.

- [ ] **Step 1: Replace the inline search-building block inside `resolveSecret`**

In `lib/ssh.js`, inside `resolveSecret`, replace this block (currently lines 79–96):

```js
    // Build search queries: by folder, and/or by each template
    let allResults = [];
    const seen = new Set();

    if (folderId) {
        const results = await searchSecrets(baseUrl, apiToken, searchTerm, folderId);
        results.forEach(r => { if (!seen.has(r.id)) { seen.add(r.id); allResults.push(r); } });
    }

    for (const tid of templateIds) {
        const results = await searchSecrets(baseUrl, apiToken, searchTerm, null, tid);
        results.forEach(r => { if (!seen.has(r.id)) { seen.add(r.id); allResults.push(r); } });
    }

    if (allResults.length === 0) {
        throw new Error(`No SSH secrets found matching "${searchTerm}". Check sshTemplates/sshFolder config or use secret ID.`);
    }
```

with:

```js
    const allResults = await searchSshSecrets(baseUrl, apiToken, searchTerm);

    if (allResults.length === 0) {
        throw new Error(`No SSH secrets found matching "${searchTerm}". Check sshTemplates/sshFolder config or use secret ID.`);
    }
```

The rest of `resolveSecret` (single match / exact match / list-options branches, lines 97–124) is unchanged.

- [ ] **Step 2: Add the two new functions**

Add these directly after the closing brace of `resolveFromResults` (currently ending at line 148) and before `async function sshFromSecret(...)` (currently line 150):

```js
async function searchSshSecrets(baseUrl, apiToken, searchTerm = '') {
    const sshTemplates = getConfigValue('sshTemplates');
    const sshFolder = getConfigValue('sshFolder');
    const templateIds = sshTemplates ? String(sshTemplates).split(',').map(s => s.trim()) : [];
    const folderId = sshFolder ? String(sshFolder) : null;

    let allResults = [];
    const seen = new Set();

    if (folderId) {
        const results = await searchSecrets(baseUrl, apiToken, searchTerm, folderId, null, 50, true);
        results.forEach(r => { if (!seen.has(r.id)) { seen.add(r.id); allResults.push(r); } });
    }

    for (const tid of templateIds) {
        const results = await searchSecrets(baseUrl, apiToken, searchTerm, null, tid);
        results.forEach(r => { if (!seen.has(r.id)) { seen.add(r.id); allResults.push(r); } });
    }

    return allResults;
}

async function listAllSshSecrets(baseUrl, apiToken) {
    const sshTemplates = getConfigValue('sshTemplates');
    const sshFolder = getConfigValue('sshFolder');
    const templateIds = sshTemplates ? String(sshTemplates).split(',').map(s => s.trim()) : [];
    const folderId = sshFolder ? String(sshFolder) : null;

    if (templateIds.length === 0 && !folderId) {
        throw new Error(
            `No sshTemplates or sshFolder configured. Run:\n` +
            `  ss-cli config set sshTemplates 6007,6010\n` +
            `  ss-cli config set sshFolder 1234`
        );
    }

    const results = await searchSshSecrets(baseUrl, apiToken);
    if (results.length === 0) {
        throw new Error(`No SSH secrets found in configured sshTemplates/sshFolder.`);
    }
    return results;
}
```

- [ ] **Step 3: Verify no syntax errors**

Run: `node -e "require('./lib/ssh.js'); console.log('ok')"` from the repo root.
Expected: prints `ok`.

- [ ] **Step 4: Manual regression check of `resolveSecret` behavior**

Run the existing hostname-based SSH lookup against a known real hostname (one you've connected to before, so the flow exercises the `sshTemplates`-scoped search path):

`node bin/ss-cli.js ssh <a-known-real-hostname> -- -o BatchMode=yes -o ConnectTimeout=3`

(`BatchMode=yes` + short `ConnectTimeout` keep this from hanging on a password prompt — we're only verifying that the *secret resolution* still logs `Found: [id] name` or `Cached: [id] name` correctly, not that the SSH session itself completes.)

Expected: same `Found:`/`Cached:` resolution message and same target host as before this refactor — confirming `searchSshSecrets` produces identical results to the old inline code for the `sshTemplates` path. Note: this machine's current config has `sshTemplates` set but no `sshFolder`, so this check exercises the template branch, not the new `includeSubFolders` folder branch — that branch's correctness was already confirmed live in Task 1 Step 3 (folder `3473`: 2 direct vs. 1320 recursive). If `sshFolder` is configured before this task runs, also verify a hostname known to live in a subfolder now resolves correctly where it previously would have failed with "No SSH secrets found."

- [ ] **Step 5: Commit**

```bash
cd ~/development/ss-cli
git add lib/ssh.js
git commit -m "Extract searchSshSecrets/listAllSshSecrets helpers from resolveSecret"
```

---

### Task 3: Add the interactive picker (`runSshList`) to `lib/ssh.js`

**Files:**
- Modify: `lib/ssh.js` (add new functions, update `module.exports`)
- Modify: `package.json` (add `enquirer` dependency)

**Interfaces:**
- Consumes: `listAllSshSecrets`, `loadSshCache` (both already defined in `lib/ssh.js` from Task 2 and the original file respectively), `sshFromSecret` (existing), `audit.log(cmd, target, success)` (from `lib/audit.js` — new import needed).
- Produces (exported): `async function runSshList(baseUrl, apiToken, useAll, sshArgs)` → `Promise<number>` (an ssh exit code, or `0` for a non-interactive plain listing / empty result). This is the only new export `bin/ss-cli.js` needs.

- [ ] **Step 1: Install the dependency**

```bash
cd ~/development/ss-cli
npm install enquirer@^2.4.1
```

Expected: `package.json` gains `"enquirer": "^2.4.1"` under `dependencies`, `package-lock.json` updates, and `npm install` reports adding a small number of packages (enquirer has few transitive deps — confirmed 4 packages total in isolated testing).

- [ ] **Step 2: Add the `audit` import**

At the top of `lib/ssh.js`, alongside the existing requires (currently lines 7–14), add:

```js
const audit = require('./audit');
```

- [ ] **Step 3: Add `cachedHostChoices` and `runSshList`**

Add these functions right before `module.exports` at the bottom of `lib/ssh.js`:

```js
function cachedHostChoices() {
    const cache = loadSshCache();
    return Object.entries(cache).map(([hostname, secretId]) => ({
        name: String(secretId),
        message: hostname
    }));
}

async function runSshList(baseUrl, apiToken, useAll, sshArgs) {
    let choices;
    let source;

    if (useAll) {
        const results = await listAllSshSecrets(baseUrl, apiToken);
        choices = results.map(r => ({ name: String(r.id), message: r.name }));
        source = 'all secrets in sshFolder/sshTemplates';
    } else {
        choices = cachedHostChoices();
        if (choices.length === 0) {
            console.error('No cached SSH hosts yet — showing all configured SSH secrets instead.');
            const results = await listAllSshSecrets(baseUrl, apiToken);
            choices = results.map(r => ({ name: String(r.id), message: r.name }));
            source = 'all secrets in sshFolder/sshTemplates';
        } else {
            source = 'cached hosts';
        }
    }

    if (choices.length === 0) {
        console.log('No SSH servers found.');
        return 0;
    }

    const interactive = Boolean(process.stdout.isTTY && process.stdin.isTTY);

    if (!interactive) {
        console.log(`${choices.length} SSH server(s) (${source}):\n`);
        choices.forEach(c => console.log(`  [${c.name}] ${c.message}`));
        return 0;
    }

    const { Select } = require('enquirer');
    const prompt = new Select({
        name: 'target',
        message: 'Select a server to connect to',
        choices
    });

    const secretId = await prompt.run();
    const label = choices.find(c => c.name === secretId).message;
    audit.log('ssh', label, true);
    return sshFromSecret(baseUrl, apiToken, secretId, sshArgs);
}
```

- [ ] **Step 4: Update `module.exports`**

Change the bottom of `lib/ssh.js` from:

```js
module.exports = { sshFromSecret, sshCopyIdFromSecret };
```

to:

```js
module.exports = { sshFromSecret, sshCopyIdFromSecret, runSshList };
```

- [ ] **Step 5: Verify no syntax errors**

Run: `node -e "const m = require('./lib/ssh.js'); console.log(typeof m.runSshList)"` from the repo root.
Expected: prints `function`.

- [ ] **Step 6: Manual verification — non-TTY plain-list path**

Run: `node -e "
const { runSshList } = require('./lib/ssh');
const { getConfigValue } = require('./lib/config');
(async () => {
  const url = getConfigValue('url');
  const token = process.env.SS_TOKEN || getConfigValue('token');
  const code = await runSshList(url, token, true, []);
  console.log('exit code:', code);
})();
" | cat`

Piping through `cat` forces non-TTY stdout even though this is an interactive shell.

Expected: prints `N SSH server(s) (all secrets in sshFolder/sshTemplates):` followed by `  [id] name` lines matching the secrets in your configured `sshFolder`/`sshTemplates`, then `exit code: 0`. No prompt should appear (no hanging, no keypress required).

- [ ] **Step 7: Manual verification — interactive picker path**

Run directly in a real terminal (not piped): `node bin/ss-cli.js` won't have the command wired up yet (that's Task 4), so verify the picker function directly:

```bash
node -e "
const { runSshList } = require('./lib/ssh');
const { getConfigValue } = require('./lib/config');
(async () => {
  const url = getConfigValue('url');
  const token = process.env.SS_TOKEN || getConfigValue('token');
  const code = await runSshList(url, token, true, ['-o', 'BatchMode=yes', '-o', 'ConnectTimeout=3']);
  console.log('exit code:', code);
})();
"
```

Expected: an arrow-key menu appears listing secret names; pressing Up/Down moves the highlight; pressing Enter on one prints `Connecting to <user>@<host>...` (from `sshFromSecret`) and then either connects or fails fast due to `BatchMode=yes` (expected, since no password prompt can be answered in batch mode) — the goal of this check is confirming the menu renders and selection reaches `sshFromSecret`, not a full login.

- [ ] **Step 8: Commit**

```bash
cd ~/development/ss-cli
git add lib/ssh.js package.json package-lock.json
git commit -m "Add runSshList interactive SSH server picker"
```

---

### Task 4: Wire up the `ssh-list` command in `bin/ss-cli.js`

**Files:**
- Modify: `bin/ss-cli.js:29` (import line)
- Modify: `bin/ss-cli.js` (add new command after the existing `ssh-copy-id` command, currently ending at line 493)

**Interfaces:**
- Consumes: `runSshList(baseUrl, apiToken, useAll, sshArgs)` from Task 3.
- Produces: new CLI command `ss-cli ssh-list [--all] [ssh-args...]`.

- [ ] **Step 1: Update the import**

Change line 29 of `bin/ss-cli.js` from:

```js
const { sshFromSecret, sshCopyIdFromSecret } = require('../lib/ssh');
```

to:

```js
const { sshFromSecret, sshCopyIdFromSecret, runSshList } = require('../lib/ssh');
```

- [ ] **Step 2: Add the command**

Add this immediately after the `ssh-copy-id` command block (after the closing `});` currently at line 493, before the `// --- run ---` comment):

```js

// --- ssh-list ---
program
    .command('ssh-list')
    .description('List SSH servers and connect interactively (cached hosts by default, --all for full sshFolder/sshTemplates scope)')
    .option('--all', 'Query all secrets in the configured sshFolder/sshTemplates instead of just cached hosts')
    .argument('[ssh-args...]', 'Extra arguments to pass to ssh on connect')
    .action(async (sshArgs, opts) => {
        const url = requireConfigValue('url');
        const token = requireToken();
        try {
            const exitCode = await runSshList(url, token, Boolean(opts.all), sshArgs);
            process.exit(exitCode);
        } catch (err) {
            console.error(`Error: ${err.message}`);
            process.exit(1);
        }
    });
```

- [ ] **Step 3: Verify the command is registered**

Run: `node bin/ss-cli.js ssh-list --help`
Expected: prints usage help showing `Usage: ss-cli ssh-list [options] [ssh-args...]`, the `--all` option, and the description text — confirming commander parsed the variadic argument plus the boolean option correctly (this is the one part of the plan not covered by earlier testing, since Task 3 called `runSshList` directly rather than through commander's argument parsing).

- [ ] **Step 4: Manual verification — full command end to end**

Run: `node bin/ss-cli.js ssh-list | cat` (non-interactive, matches Task 3 Step 6's expected output) and then `node bin/ss-cli.js ssh-list --all | cat`.
Expected: both print a plain `[id] name` list, matching Task 3's verified `runSshList` output, this time reached through the actual CLI entrypoint and commander's option parsing.

- [ ] **Step 5: Commit**

```bash
cd ~/development/ss-cli
git add bin/ss-cli.js
git commit -m "Add ss-cli ssh-list command"
```

---

### Task 5: Document `ssh-list` in the README

**Files:**
- Modify: `README.md` (SSH section, currently lines 238–283)

**Interfaces:**
- None (documentation only).

- [ ] **Step 1: Insert a new subsection**

In `README.md`, insert a new `### ssh-list` subsection immediately after the closing ` ``` ` of the initial SSH usage example (after the line `ss-cli ssh 18114 -- -L 8080:localhost:80` and its closing fence, currently ending at line 252) and before the `### How hostname search works` heading (currently line 254):

```markdown

### ssh-list

Browse and pick a server interactively instead of typing a hostname or ID:

```bash
# Pick from servers you've connected to before (no API call)
ss-cli ssh-list

# Pick from every SSH secret in the configured sshFolder/sshTemplates
ss-cli ssh-list --all

# Extra SSH arguments are forwarded on connect, same as `ssh <target>`
ss-cli ssh-list --all -- -L 8080:localhost:80
```

Use arrow keys to highlight a server and press Enter to connect. If you haven't
connected to anything yet, `ss-cli ssh-list` automatically falls back to `--all`.
When output isn't a terminal (e.g. piped or scripted), it prints a plain list
instead of the interactive menu.
```

- [ ] **Step 2: Verify the Markdown renders sensibly**

Run: `sed -n '238,300p' README.md` and read through it.
Expected: the new subsection reads naturally between the initial usage examples and "How hostname search works", with no broken code fences (every ` ``` ` opened is closed).

- [ ] **Step 3: Commit**

```bash
cd ~/development/ss-cli
git add README.md
git commit -m "Document ssh-list in README"
```

---

### Task 6: Version bump and final end-to-end verification

**Files:**
- Modify: `package.json:3` (`version` field)

**Interfaces:**
- None (release metadata only).

- [ ] **Step 1: Bump the version**

In `package.json`, change:

```json
  "version": "1.8.2",
```

to:

```json
  "version": "1.9.0",
```

(Minor bump: new backwards-compatible feature, no breaking changes to `ssh`/`ssh-copy-id`, per this repo's SemVer convention.)

- [ ] **Step 2: Full end-to-end manual pass**

Run each of these in a real terminal (not piped) and confirm the described result:

1. `node bin/ss-cli.js ssh-list` — with a non-empty `ssh-cache.json` (from having run `ss-cli ssh <hostname>` before): shows an arrow-key menu of cached hostnames.
2. Temporarily rename `~/.config/ss/ssh-cache.json` out of the way (`mv ~/.config/ss/ssh-cache.json ~/.config/ss/ssh-cache.json.bak`), then run `node bin/ss-cli.js ssh-list` again: prints "No cached SSH hosts yet — showing all configured SSH secrets instead." to stderr and shows the `--all` menu instead of erroring. Restore the cache file afterward (`mv ~/.config/ss/ssh-cache.json.bak ~/.config/ss/ssh-cache.json`).
3. `node bin/ss-cli.js ssh-list --all`: shows every secret in the configured `sshFolder`/`sshTemplates` scope.
4. Select an entry from the menu in one of the above and confirm it prints `Connecting to <user>@<host>...` and behaves exactly like `ss-cli ssh <that-same-target>` would (same password-delivery method chosen, same connection behavior).
5. `ss-cli ssh <target>` and `ss-cli ssh-copy-id <target>` (a couple of known-good targets) still work exactly as before — confirming Task 2's refactor didn't regress them.

- [ ] **Step 3: Commit**

```bash
cd ~/development/ss-cli
git add package.json
git commit -m "Bump version to 1.9.0 for ssh-list feature"
```

- [ ] **Step 4: Stop — do not push or tag**

Per this repo's release workflow, pushing and tagging (`git push && git tag v1.9.0 && git push origin v1.9.0`) triggers the GitHub Actions workflow that publishes to npm and cuts a GitHub Release — an irreversible, externally-visible action. Do not run this as part of automated plan execution. Report completion to the user and let them decide when to push/tag.

---

## Self-Review Notes

- **Spec coverage:** Command surface (Task 4), cached vs `--all` data sources with shared query logic (Tasks 2–3), TTY detection and plain-list fallback (Task 3), reuse of `sshFromSecret` via numeric ID (Task 3), empty-cache auto-fallback (Task 3), README documentation (Task 5), version bump (Task 6) — all covered.
- **Placeholder scan:** no TBD/TODO markers; every step has literal code or literal shell commands.
- **Type/name consistency:** `runSshList(baseUrl, apiToken, useAll, sshArgs)` signature is identical everywhere it's referenced (Task 3 definition, Task 4 call site, Task 6 verification). `searchSshSecrets`/`listAllSshSecrets` names match between their Task 2 definition and Task 3's usage. Choice shape `{ name, message }` matches enquirer's confirmed `Select` prompt API (verified interactively: single-select `submit()` resolves to `choice.name`, `message` controls display text only).
