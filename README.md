# GROWTHSTAR Vault browser extension

The password manager extension for [GROWTHSTAR Vault](https://growthstar.app/vault/).
It is Bitwarden's open-source browser extension, rebranded and locked to one server,
`vault.growthstar.app`.

**Built on open-source Bitwarden code. Not affiliated with Bitwarden, Inc.** "Bitwarden" is a
trademark of Bitwarden, Inc. This project uses no Bitwarden name, logo or artwork except where a
line truthfully names Bitwarden's own apps, help centre or support.

## What is in this repository

This repository holds only the GROWTHSTAR layer. It does not hold a copy of Bitwarden's code.
Each build starts from an unmodified Bitwarden release and applies:

| Path | What it does |
|---|---|
| `brand/brand.json` | Name, server, links, attribution |
| `brand/strings.json` | Which messages keep the Bitwarden name (it names Bitwarden's own things) and which get custom text |
| `brand/icons/`, `brand/logo/`, `brand/palette.json` | Artwork and colours, from the GROWTHSTAR suite marks |
| `scripts/apply-branding.mjs` | Applies all of the above, anchored and fail-loud |
| `scripts/verify-build.mjs` | Checks a finished build |
| `scripts/smoke-test.mjs` | Installs the build in a real browser and proves where sign-in goes |
| `scripts/make-icons.mjs` | Redraws the icons (not used by CI) |
| `.github/workflows/upkeep.yml` | Daily: new Bitwarden release → brand → build → check → test → release |
| `docs/UPKEEP.md` | What the coder agent does when a run fails |

## Build it yourself

```bash
git clone --depth 1 --branch browser-v2026.9.1 https://github.com/bitwarden/clients.git
node scripts/apply-branding.mjs clients --build 1
cd clients && npm ci && cd apps/browser && npm run dist:chrome
node ../../../scripts/verify-build.mjs build
```

Only Bitwarden's plain build scripts are used. The `build:bit:*` scripts and the
`bitwarden_license/` folder, which are under Bitwarden's commercial licence, are never built.

## Licence

GPL-3.0, the same as the Bitwarden code it is built on (see `LICENSE`). Every release attaches the
exact patch applied to the upstream source, and `SOURCE.txt` names the upstream tag and this
repository's commit.

## Known limits

- Unlocking with biometrics through the Bitwarden desktop app does not work. That app only
  talks to Bitwarden's own extension.
- Safari is not built. It ships inside a Mac app and needs an Apple developer account.
