#!/usr/bin/env node
'use strict';

// Local bridge for Claude Desktop.
//
// Claude Desktop speaks MCP to this process over stdio. We run the bundled
// `mcp-remote` proxy IN THIS PROCESS, which connects to a Polytomic MCP server
// over Streamable HTTP and injects a Polytomic API key. The Polytomic server
// only needs to be reachable from THIS machine — Anthropic's cloud never
// connects to it, which is what makes on-prem / non-public deployments work.
//
// Why in-process instead of spawning a child: inside Claude Desktop,
// process.execPath is the Electron binary, not node. Spawning it to run
// proxy.js tries to boot a second Electron app and dies with
// "Unable to find helper app" (even with ELECTRON_RUN_AS_NODE set). proxy.js
// reads process.argv on import and drives process.stdin/stdout, so importing it
// here runs the proxy directly on the stdio Claude already gave us.
//
// TLS trust for a private/internal CA comes from the OS trust store. Claude
// Desktop's Electron runtime ignores both NODE_EXTRA_CA_CERTS and
// NODE_OPTIONS=--use-system-ca, so we load the OS trust store IN-PROCESS via the
// tls API (which the proxy, also in-process, then uses). Install the internal
// root CA in the OS trust store and it works with no per-user config.
//
// Configuration arrives as environment variables set by the .mcpb manifest from
// the user's install-time input. All diagnostics go to stderr; stdout is
// reserved for the MCP transport.

const tls = require('node:tls');
const { pathToFileURL } = require('node:url');

function fail(msg) {
  process.stderr.write(`[polytomic-connector] ${msg}\n`);
  process.exit(1);
}

// cfg reads a config env var. When an optional user_config field is left blank,
// mcpb leaves the literal "${user_config.x}" placeholder in the environment
// instead of an empty string, so treat any unsubstituted placeholder as unset.
function cfg(name) {
  const v = String(process.env[name] || '').trim();
  if (v.startsWith('${') && v.endsWith('}')) return '';
  return v;
}

function truthy(v) {
  return /^(true|1|yes|on)$/i.test(v);
}

// normalizeServerUrl is forgiving about how a user types the endpoint. It
// accepts a bare host ("mcp.example.com"), a host with no path, extra slashes,
// or a pasted value with surrounding quotes, and returns a clean
// https://host[:port]/mcp URL. We default a missing scheme to https, upgrade a
// plain-http URL (this bridge is https-only), and default a missing path to
// /mcp (a host that already has its own path is left alone).
function normalizeServerUrl(raw) {
  let s = String(raw || '')
    .trim()
    .replace(/^['"]+|['"]+$/g, '')
    .trim();
  if (!s) fail('MCP server URL is required.');
  if (!/^[a-z][a-z0-9+.-]*:\/\//i.test(s)) s = 'https://' + s;

  let u;
  try {
    u = new URL(s);
  } catch {
    fail(`MCP server URL is not a valid URL: "${raw}"`);
  }

  if (u.protocol === 'http:') {
    process.stderr.write('[polytomic-connector] note: upgraded http:// to https:// (this bridge is https-only)\n');
    u.protocol = 'https:';
  }
  if (u.protocol !== 'https:') {
    fail(`MCP server URL must be https (got scheme "${u.protocol}").`);
  }
  if (!u.hostname) fail(`MCP server URL has no host: "${raw}"`);

  const path = u.pathname.replace(/\/+$/, '');
  u.pathname = path === '' ? '/mcp' : path;
  u.search = '';
  u.hash = '';
  return u.toString();
}

const serverUrl = normalizeServerUrl(cfg('PT_SERVER_URL'));
const apiKey = cfg('PT_API_KEY');
const readOnly = truthy(cfg('PT_READ_ONLY'));

if (!apiKey) fail('Polytomic API key is required.');

let proxy;
try {
  proxy = require.resolve('mcp-remote/dist/proxy.js');
} catch {
  fail('Bundled mcp-remote was not found. Run `npm install` before packing.');
}

// Extend the default CAs with the OS trust store, in-process (see note above).
// This is what makes an internal-CA HTTPS server verify inside Claude Desktop.
let systemCount = 0;
if (typeof tls.setDefaultCACertificates === 'function' && typeof tls.getCACertificates === 'function') {
  try {
    const cas = [...tls.getCACertificates()];
    try {
      const sys = tls.getCACertificates('system');
      systemCount = sys.length;
      cas.push(...sys);
    } catch {
      /* getCACertificates('system') unsupported on this Node */
    }
    tls.setDefaultCACertificates(cas);
  } catch (e) {
    process.stderr.write(`[polytomic-connector] CA setup warning: ${e.message}\n`);
  }
}

// mcp-remote expands ${PT_AUTH} in header values from the environment, so the
// API key never appears in argv.
process.env.PT_AUTH = `Bearer ${apiKey}`;

const args = [serverUrl, '--transport', 'http-only', '--header', 'Authorization:${PT_AUTH}'];
if (readOnly) args.push('--header', 'X-Polytomic-Access-Mode:read-only');

// proxy.js parses process.argv.slice(2); argv[0]/argv[1] are ignored.
process.argv = [process.argv[0], proxy, ...args];

process.stderr.write(
  `[polytomic-connector] starting (in-process): url=${serverUrl} read_only=${readOnly} system_ca=${systemCount}\n`,
);

import(pathToFileURL(proxy).href).catch((err) => {
  fail(`mcp-remote failed to start: ${(err && err.stack) || err}`);
});
