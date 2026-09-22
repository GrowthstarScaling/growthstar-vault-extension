# Keeping GROWTHSTAR Vault current

This runbook is for the coder agent. You only get here when the deterministic upkeep failed.

## How upkeep works

1. `.github/workflows/upkeep.yml` runs every day at 06:17 UTC. It finds Bitwarden's newest
   browser release (`browser-vYYYY.M.P`) and, if GROWTHSTAR Vault has no release for it yet,
   builds one.
2. `scripts/apply-branding.mjs` rebrands a clean upstream checkout. Every edit is anchored on
   exact upstream text with an expected hit count. A miss fails the run, and nothing is guessed.
3. Chrome, Edge and Firefox are built with Bitwarden's plain (GPL) scripts. `scripts/verify-build.mjs`
   checks each build. `scripts/smoke-test.mjs` installs the Chrome build in a real browser and proves
   that sign-in goes to vault.growthstar.app and nowhere else.
4. The run then publishes a GitHub release `vYYYY.M.P.N`. Store upload is a separate step that
   the owner approves.
5. On failure, the run opens a GitHub issue labelled `needs-coder` with the tail of every log.
   A watcher on the GROWTHSTAR server turns each new issue into a
   kanban task for you.

## What you may change

Only these paths: `brand/strings.json`, `brand/brand.json` (not `server`), and the anchors and
edits in `scripts/apply-branding.mjs`, `scripts/verify-build.mjs` and `scripts/smoke-test.mjs`.

Never:
- change `server`, `welcomeUrl` or the one-server edit in `default-environment.service.ts` to point anywhere else;
- add an edit that changes what the extension does with passwords, keys, sync or network traffic.
  The branding changes names, pictures, colours and links, and it pins the server. Nothing else;
- weaken or delete a check in `verify-build.mjs` or `smoke-test.mjs` to make a run pass;
- use `build:bit:*` scripts or anything under `bitwarden_license/`;
- push to `main`. The owner merges.

## Fixing a failed run

1. Read the issue. The `MISS` or `FAIL` lines say exactly what moved.
2. Reproduce it locally, source only (no `npm ci` needed for branding misses):
   ```bash
   git clone --depth 1 --branch <tag> https://github.com/bitwarden/clients.git /tmp/bw
   node scripts/apply-branding.mjs /tmp/bw --build 1
   ```
3. Find the new upstream text (`grep -rn` in `/tmp/bw`) and update the anchor so it matches
   exactly once again. If a key in `brand/strings.json` was deleted upstream, remove it. If a
   new message says Bitwarden, decide by what it names: this service → leave it to the default
   rule; Bitwarden's own separate apps, help centre or support → add it to `keep`.
4. Run the branding script until it exits 0 on a fresh clone.
5. Commit on a branch named `upkeep/<tag>` and push it with the repo deploy key:
   ```bash
   git push git@github-vault-extension:GrowthstarScaling/growthstar-vault-extension.git HEAD:upkeep/<tag>
   ```
   CI builds and tests that branch exactly like a release. If it passes, CI opens a pull request
   for the owner to merge. If it fails, read the new comment on the issue and repeat.
6. Comment on the issue with what moved and what you changed.

If Bitwarden changed something that the branding cannot follow with an anchor change (for example,
the settings page was rebuilt or the logo is now drawn somewhere new), stop after step 3. Describe
it on the issue and ask for review. Do not improvise a bigger patch.
