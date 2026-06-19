# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## What this is

A Claude Desktop extension (`.mcpb` bundle) that bridges Claude Desktop to a
Polytomic MCP server using a Polytomic API key. The whole product is one small
Node bridge (`server/index.js`) plus packaging/release tooling — there is no
build step for the bridge itself; the source ships as-is inside the bundle.

The bridge's reason to exist: the Polytomic server only needs to be reachable
**from the user's machine**, not from Anthropic's cloud. That's what makes it
work for on-prem / non-public deployments where the normal remote-connector
OAuth/discovery flow can't reach the host.

## Commands

```sh
npm install          # populate node_modules/ (SHIPPED inside the bundle)
npm run validate     # validate manifest.json against the mcpb schema
npm run pack         # build dist/polytomic-connector.mcpb

make release BUMP=patch   # bump version (minor/major, or TO=X.Y.Z), commit, tag vX.Y.Z
make push                 # push commit + tag -> triggers release workflow
make                      # list all release targets + current version
```

There is no test suite and no linter. Requires Node 20+.

## Architecture

`server/index.js` is the entire runtime. Flow:

```
Claude Desktop --stdio--> bridge (this) --HTTPS--> Polytomic MCP server
                          injects Authorization: Bearer <api key>
```

The bridge runs the bundled [`mcp-remote`](https://github.com/geelen/mcp-remote)
proxy in **static-header mode** (no OAuth). Non-obvious design points worth
knowing before editing `server/index.js`:

- **`mcp-remote` runs in-process, not as a child.** Inside Claude Desktop,
  `process.execPath` is the Electron binary, not node, so spawning it tries to
  boot a second Electron app and fails. Instead the bridge rewrites
  `process.argv` and `import()`s `mcp-remote/dist/proxy.js`, which reads argv on
  import and drives stdin/stdout directly.
- **TLS trust is loaded in-process via the `tls` API.** Claude Desktop's
  Electron runtime ignores `NODE_EXTRA_CA_CERTS` and `NODE_OPTIONS=--use-system-ca`,
  so `tls.setDefaultCACertificates()` merges the OS trust store at startup. This
  is what lets an internal/private-CA HTTPS server verify with no per-user config.
- **The API key never appears in argv.** It is passed to `mcp-remote` via the
  `PT_AUTH` env var, which `mcp-remote` expands inside the `--header` value.
- **stdout is reserved for the MCP transport.** All diagnostics go to stderr.
- **Read-only mode** maps the `read_only` checkbox to the
  `X-Polytomic-Access-Mode: read-only` header. The `.mcpb` manifest format has
  no enum/dropdown field type, so this is a boolean checkbox, not a mode picker.

Config arrives as env vars (`PT_SERVER_URL`, `PT_API_KEY`, `PT_READ_ONLY`) that
the manifest substitutes from install-time user input. A blank optional field
arrives as the literal unsubstituted placeholder string `${user_config.x}`, not
an empty string — `cfg()` treats any such placeholder as unset. `normalizeServerUrl()`
is deliberately forgiving (bare host, missing scheme, trailing slashes, quotes)
and always returns an `https://host/mcp` URL.

## Versioning and release

`manifest.json` is the **source of truth** for the version — Claude Desktop reads
it and compares it to decide an in-place update. `make release` keeps
`package.json` / `package-lock.json` in sync, validates, commits `Release vX.Y.Z`,
and tags. Pushing a `v*` tag runs `.github/workflows/release.yml`, which packs the
bundle and attaches `polytomic-connector.mcpb` to the GitHub Release. When bumping
manually, bump **both** `manifest.json` and `package.json`.

## Bundle packaging gotcha

`node_modules/` is shipped inside the `.mcpb` (it contains `mcp-remote` and its
`dist/`). Because of that, `.mcpbignore` patterns **must be root-anchored**: an
unanchored `dist` pattern would also match `node_modules/mcp-remote/dist` and
break the bundle. The `mcpb` packer itself is run via `npx` and is not bundled.
