# Putting GROWTHSTAR Vault in the browser stores

Every release already produces the exact packages the stores want. What is missing is the
accounts, which only the owner can open, and the one-time listing text and pictures.

## What the owner has to do once

| Store | Cost | Account |
|---|---|---|
| Chrome Web Store | one-time $5 developer fee | chrome.google.com/webstore/devconsole |
| Microsoft Edge Add-ons | free | partner.microsoft.com/dashboard/microsoftedge |
| Firefox Add-ons | free | addons.mozilla.org/developers |

Use a GROWTHSTAR account for all three, not a personal one, and turn on two-factor
authentication. Whoever holds these accounts can push an update into every partner's browser,
so they are as sensitive as the server itself.

## First submission (by hand, once per store)

1. Download the newest release from this repository: `growthstar-vault-chrome-<version>.zip`,
   `...-edge-...`, `...-firefox-...`.
2. Upload the zip, then fill in the listing:
   - **Name**: GROWTHSTAR Vault
   - **Summary**: Your GROWTHSTAR passwords, passkeys and notes, kept safe and filled in for you on every site.
   - **Category**: Productivity
   - **Icon**: `brand/icons/store-icon-128.png`
   - **Screenshots**: the pictures the build test takes (`out/screenshots/` in the run's artifact),
     or fresh ones from a real browser
   - **Privacy**: the extension talks only to vault.growthstar.app. It collects nothing and sends
     nothing anywhere else, which the build test proves on every release.
   - **Justification for permissions** (reviewers ask): it is a password manager. It reads and
     fills fields on the sites where the person saved a login.
3. Expect a slower review than a normal extension. Password managers read every page, so all
   three stores look harder.

## After the accounts exist

Give the repository these secrets and the upload step can be switched on, with publishing still
a human decision:

- Chrome: `CHROME_CLIENT_ID`, `CHROME_CLIENT_SECRET`, `CHROME_REFRESH_TOKEN`, `CHROME_EXTENSION_ID`
- Edge: `EDGE_PRODUCT_ID`, `EDGE_CLIENT_ID`, `EDGE_API_KEY`
- Firefox: `AMO_JWT_ISSUER`, `AMO_JWT_SECRET`

Until then, the daily job stops at a GitHub release and nothing reaches a store by itself.
