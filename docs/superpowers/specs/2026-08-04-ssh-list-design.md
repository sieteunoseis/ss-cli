# ssh-list: interactive SSH server picker

## Problem

`ss-cli ssh <target>` connects to a server given a secret ID or hostname, but there's
no way to browse what's available. Users who've configured `sshFolder`/`sshTemplates`
(per the SSH section of the README) have no way to see or pick from the servers in
that scope without going to Secret Server directly.

## Goals

- List servers reachable via SSH secrets.
- Let the user select one from an arrow-key menu and connect immediately.
- Keep the fast path (no API round-trip) for servers already used before.
- Don't touch the existing `ss-cli ssh <target>` / `ssh-copy-id <target>` behavior.

## Command

New flat command, alongside `ssh` and `ssh-copy-id` (not a subcommand of `ssh`, since
`ssh <target>` already takes a required positional argument):

```bash
ss-cli ssh-list                            # picker over cached hosts
ss-cli ssh-list --all                      # picker over all secrets in sshFolder/sshTemplates
ss-cli ssh-list -- -L 8080:localhost:80    # extra args forwarded to ssh on connect
```

## Data sources

**Cached (default)**
Reads `~/.config/ss/ssh-cache.json` (already maintained by `ssh <hostname>` lookups —
hostname → secretId, via `loadSshCache` in `lib/ssh.js`). Each entry becomes a menu
choice labeled by hostname. No API call.

If the cache is empty, automatically falls back to the `--all` behavior below instead
of dead-ending.

**`--all` (or automatic fallback)**
Reuses the same folder/template query `resolveSecret` already performs when narrowing
an ambiguous hostname search: query `/api/v1/secrets` filtered by the configured
`sshFolder` and/or `sshTemplates` (config keys, see README), deduped by secret ID.

This logic currently lives inline inside `resolveSecret`'s "Build search queries"
block, parameterized by a hostname search term. Extract it into a shared helper in
`lib/ssh.js`:

```js
async function searchSshSecrets(baseUrl, apiToken, searchTerm = '') { ... }
```

`resolveSecret` calls it with the hostname search term (existing behavior, unchanged);
`ssh-list --all` calls it with no term to get every secret in scope. `searchSecrets`
(`lib/search-secrets.js`) must omit the `filter.searchText` query param entirely when
`searchTerm` is falsy, rather than sending an empty string, so the API returns
everything in the folder/template scope instead of an empty-string-match subset.

If neither `sshFolder` nor `sshTemplates` is configured, errors with the existing
message:

```
No sshTemplates or sshFolder configured. Run:
  ss-cli config set sshTemplates 6007,6010
  ss-cli config set sshFolder 1234
```

If the query returns zero results, prints the existing style of message:
`No SSH secrets found matching...` (adapted to omit the search term when listing all).

Each result becomes a menu choice labeled by secret name.

## Interaction & connect flow

- Add `enquirer` as a new dependency (CommonJS-friendly, minimal transitive deps) for
  its `Select` prompt.
- TTY check: if `process.stdout.isTTY && process.stdin.isTTY`, show the interactive
  arrow-key menu. Otherwise (piped/scripted/non-interactive), skip the menu and print
  a plain list instead, matching the existing `search` command's output style:
  `  [id] name`. In the non-TTY case, no connection is attempted — the command just
  lists and exits 0, since there's no user to make a selection.
- On interactive selection: call the existing `sshFromSecret(url, token,
  String(secretId), sshArgs)` with the numeric secret ID. A numeric target
  short-circuits `resolveSecret`'s search path (see existing `if (/^\d+$/.test(target))`
  check), so no new connection logic is needed — this reuses the exact same password
  handling (sshpass/expect/askpass) as `ssh <target>` today.
- `audit.log('ssh', <hostname-or-name>, true)` before connecting, matching the
  existing `ssh` command's audit call.
- `process.exit(exitCode)` after connecting, matching `ssh <target>`'s tail behavior.

## Out of scope

- No changes to `ss-cli ssh <target>` or `ss-cli ssh-copy-id <target>` invocation or
  behavior.
- No new config keys — reuses `sshFolder`/`sshTemplates`/`sshDomain`/`sshUsername`.
- No caching of the `--all` result set between runs (always a fresh query).

## Files touched

- `lib/ssh.js` — extract `searchSshSecrets` helper (used by both `resolveSecret` and
  the new list flow); export `loadSshCache` (already exists internally, needs
  exporting) and a new `listSshTargets(baseUrl, apiToken, useAll)` that returns the
  menu choices for either source; new `sshListInteractive(...)` orchestration used by
  the CLI command.
- `lib/search-secrets.js` — omit `filter.searchText` when the term is falsy.
- `bin/ss-cli.js` — register `ssh-list` command.
- `package.json` — add `enquirer` dependency; bump version `1.8.2` → `1.9.0` (new
  backwards-compatible feature, per this repo's SemVer convention).
- `README.md` — document `ssh-list` in the existing "## SSH" section.

## Testing

- Manual: `ss-cli ssh-list` with a populated cache (menu shows cached hosts, Enter
  connects). Empty cache → falls back to `--all` automatically. `ss-cli ssh-list --all`
  with `sshFolder`/`sshTemplates` configured. Piped invocation
  (`ss-cli ssh-list | cat`) prints a plain list instead of hanging on a prompt.
- No existing test suite in this repo (README/manual verification is the established
  pattern here); no new automated tests planned beyond that.
