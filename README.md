# Polytomic Connector for Claude Desktop (.mcpb)

A Claude Desktop extension that connects to a Polytomic MCP server using a
Polytomic **API key**. It runs a small local bridge that proxies MCP traffic
from Claude Desktop to your Polytomic server and injects the key.

The key property: the Polytomic server only needs to be reachable **from your
machine**. Anthropic's cloud never connects to it. That's what makes this work
for **on-premises** and other non-public deployments, where Anthropic can't
reach the host to run the usual remote-connector OAuth/discovery flow.

## How it works

```
Claude Desktop  --stdio-->  bridge (this extension)  --HTTPS-->  Polytomic MCP server
                            injects Authorization: Bearer <api key>
```

Under the hood the bridge runs [`mcp-remote`](https://github.com/geelen/mcp-remote)
in static-header mode (no OAuth). `server/index.js` reads the install-time
configuration, maps the **Read-only access** checkbox to the
`X-Polytomic-Access-Mode: read-only` header, and passes the API key via an
environment variable so it never appears in the process command line.

## Install (end user)

1. Download `polytomic-connector.mcpb` from the
   [latest release](../../releases/latest).
2. Double-click it, or in Claude Desktop go to **Settings -> Extensions** and
   install the file.
3. In the install dialog, fill in:
   - **MCP server URL** — the full URL ending in `/mcp`, e.g.
     `https://mcp.polytomic-local.com/mcp`.
   - **Polytomic API key** — created in Polytomic under **Settings -> API keys**.
     It's stored in your OS keychain.
   - **Read-only access** *(optional)* — restricts the connection to read-only
     Polytomic operations.

The tools appear once the extension is enabled. No `Authorization` header is
configured by hand.

The server URL must be **HTTPS**. For a private/internal TLS CA, install the
internal **root CA** into your OS trust store (keychain / system cert store);
the bridge loads the OS trust store at startup so the server's certificate
verifies. Corporate machines often have this already via MDM.

> **Mode is a checkbox, not a dropdown.** The .mcpb manifest format has no
> dropdown/enum field type, so the full-access vs read-only choice is a
> **Read-only access** checkbox (unchecked = full access).

## Build it yourself

Requires Node.js 20+.

```sh
npm install
npm run validate     # check manifest.json against the mcpb schema
npm run pack         # writes dist/polytomic-connector.mcpb
```

`npm install` populates `node_modules/` (which is shipped inside the bundle);
the `mcpb` packer itself is run via `npx` and not bundled.

## Releases

Use the Makefile:

```sh
make release BUMP=patch   # or minor / major, or TO=X.Y.Z
make push                 # push the commit + tag
```

`make release` bumps the version in `manifest.json` (the source of truth) and
`package.json`/`package-lock.json`, validates the manifest, commits, and tags
`vX.Y.Z`. `make push` pushes the commit and tag, which runs
`.github/workflows/release.yml` to pack the bundle and attach
`polytomic-connector.mcpb` to the GitHub Release. Run `make` with no target for
the full list.

(You can also push a `v*` tag by hand, or run the workflow manually from the
**Actions** tab to build the bundle without cutting a release.)

## Updating

Privately distributed `.mcpb` bundles **do not auto-update** — only extensions
installed from the official Anthropic extension directory do. So a new release is
delivered the same way as the first install: the user downloads the new bundle
and double-clicks it.

To ship an update:

1. Bump `version` in **both** `manifest.json` and `package.json` (Claude Desktop
   compares the manifest `version` to decide it's an update).
2. Repack (`npm run pack`) or cut a tagged release (see [Releases](#releases)).
3. The user double-clicks the new `.mcpb`. Because it has the same `name` (and so
   the same extension id) and a higher `version`, Claude Desktop **updates it in
   place** instead of adding a duplicate.

Notes:

- **Config carries over** an in-place update — the server URL, the keychain-stored
  API key, and the checkboxes are tied to the extension, not the version, so users
  don't re-enter them. (Removing the extension first, by contrast, clears its
  config.)
- Each install/update of an **unsigned** bundle shows the "Installing unsigned
  extension" prompt. Signing the bundle removes that.
- If a future bundle ever needs the user to re-enter configuration (e.g. a new
  required field), call it out in the release notes, since the update is silent
  otherwise.
- Some Claude Desktop builds have shipped with extension install/update
  temporarily broken; if an update won't apply, check whether the Desktop version
  is a known-bad one before suspecting the bundle.

## Scope and limitations

- **Claude Desktop only.** `.mcpb` extensions are a Claude Desktop feature. They
  don't apply to claude.ai on the web. For **Claude Code**, you don't need this
  bridge at all when it runs on a machine that can reach the server — use
  `claude mcp add --transport http <url> --header "Authorization: Bearer <key>"`
  directly.
- **API key auth only** in this version (no browser SSO/consent). Revoke access
  by deleting the API key in Polytomic.
- **HTTPS only.** The server URL must be HTTPS; plain HTTP is refused.

## Security notes

- The API key is marked `sensitive` in the manifest, so Claude Desktop stores it
  in the OS keychain and masks it in the UI.
- The bridge passes the key to `mcp-remote` via an environment variable, so it
  is not visible in the process's command-line arguments.
- All bridge diagnostics go to stderr; stdout carries only the MCP transport.
