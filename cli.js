#!/usr/bin/env node
// Competitor seed shortlist for PeekPanda. Node 18+, no dependencies. Read-only (scope context:read):
//   GET /v1/starter-boards/search?query=...   resolve an app name to a stored iOS listing, at most 8 hits (MCP starter_boards action search)
//   GET /v1/starter-boards/app-<storeId>       the app + up to five potential competitors with match reasons (MCP starter_boards action detail)
// Neither read starts collection. Adoption (POST .../adopt, content:write) is only printed with --commands, never run.
import { readFile, writeFile } from 'node:fs/promises';
import { parseInput, pickCandidate, seedReport, buildReport, diff, toMarkdown, toCsv, toChat, adoptCommands } from './seed.js';

const HELP = `Usage:
  PEEKPANDA_TOKEN=... node cli.js --apps "Headspace,Calm,id1459969523"   seed each app (1-2 calls per app)
  PEEKPANDA_TOKEN=... node cli.js --apps-file my-apps.txt                 one app per line, # comments
  node cli.js --file run.json [opts]                                      re-render a saved run

Each app is a store ID, id123..., an apps.apple.com link, or a name (resolved with one search call).
Add =Label to name it in the report, e.g. "1459969523=our iOS app".

Options:
  --apps <list>          comma-separated apps (up to 20)
  --apps-file <path>     one app per line
  --state <path>         compare with the report saved at this path, then save this run there
  --save <path>          save the raw answers (preview tokens removed); re-render later with --file
  --format md|csv|json   output format (default md)
  --webhook <url>        also POST a short summary to a Slack or Discord incoming webhook
  --commands             print the adopt curl lines (POST /v1/starter-boards/app-<id>/adopt, content:write) with
                         this run's preview tokens. Never run by this tool. Same-category matches are left out
                         unless --keep-weak. Peek adopts one app; Panda the set within its tracked-app allowance.
  --keep-weak            keep same-category matches in --commands
  --tenancy <selector>   send x-genviral-tenancy (a workspace id). Left out by default: a key pinned to a
                         workspace reads that workspace, and naming one it cannot reach answers 403 workspace_not_accessible.
  --api <url>            API base (default https://api.peekpanda.com)

Every call counts toward your plan's daily API and MCP allowance (Peek 30, Panda 1,000, reset 00:00 UTC).`;

const FLAGS = new Set(['--help', '-h', '--commands', '--keep-weak']);
function parse(argv) {
  const o = { format: 'md', api: 'https://api.peekpanda.com' };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (FLAGS.has(a)) o[a === '-h' ? 'help' : a.slice(2)] = true;
    else if (a.startsWith('--')) {
      const v = argv[++i];
      if (v == null) throw new Error(`${a} needs a value. See --help.`);
      o[a.slice(2)] = v;
    } else throw new Error(`Unexpected argument "${a}". See --help.`);
  }
  return o;
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
let calls = 0;
class StopError extends Error {}

async function call(o, path, query = {}, retried = false) {
  const token = process.env.PEEKPANDA_TOKEN;
  if (!token) throw new StopError('Set PEEKPANDA_TOKEN to a PeekPanda API key (Account → API keys). Never commit it.');
  const url = new URL(path, o.api);
  for (const [k, v] of Object.entries(query)) if (v != null && v !== '') url.searchParams.set(k, String(v));
  calls++;
  const headers = { Accept: 'application/json', Authorization: `Bearer ${token}` };
  if (o.tenancy) headers['x-genviral-tenancy'] = o.tenancy;
  const res = await fetch(url, { headers });
  if (res.ok) return res.json();
  const body = await res.json().catch(() => null);
  const code = body?.error?.code ?? '';
  const retry = Number(res.headers.get('retry-after') ?? body?.error?.retryAfterSeconds);
  if ((code === 'rate_limited' || res.status === 503) && !retried && retry > 0 && retry <= 70) {
    await sleep(retry * 1000);
    return call(o, path, query, true);
  }
  const msg = `${res.status} ${code}`.trim();
  if (code === 'daily_call_limit') throw new StopError(`PeekPanda API ${msg}: the daily API and MCP allowance is used until 00:00 UTC; stopping.`);
  if ([401, 402, 403].includes(res.status)) {
    const hint = { workspace_not_accessible: ' The key cannot reach that tenancy; leave out --tenancy or use a selector from GET /v1/workspaces.', authorization_required: ' Check the key scopes (context:read).', subscription_required: ' These reads need a plan with API access.' }[code] ?? '';
    throw new StopError(`PeekPanda API ${msg} (GET ${path}): ${String(body?.error?.message ?? res.statusText).replace(/\.$/, '')}.${hint}`);
  }
  return { error: `${msg}${body?.error?.message ? ` ${String(body.error.message).replace(/\.$/, '')}` : ''}` };
}

async function readApps(o) {
  const list = [];
  if (o.apps) list.push(...o.apps.split(','));
  if (o['apps-file']) list.push(...(await readFile(o['apps-file'], 'utf8')).split('\n').map((l) => l.replace(/#.*/, '')));
  const apps = list.map((s) => s.trim()).filter(Boolean);
  if (!apps.length) throw new Error('Give --apps, --apps-file or --file. See --help.');
  if (apps.length > 20) throw new Error('At most 20 apps per run (each one is 1-2 API calls).');
  return apps.map(parseInput);
}

async function fetchAll(o) {
  const items = [], unresolved = [], tokens = new Map();
  for (const want of await readApps(o)) {
    let resolved = { input: want.input, label: want.label };
    let storeId = want.storeId;
    try {
      if (!storeId) {
        if (want.query.length < 2 || want.query.length > 200) { unresolved.push({ input: want.input, why: 'search needs 2 to 200 characters' }); continue; }
        const r = await call(o, '/v1/starter-boards/search', { query: want.query });
        if (r.error) { unresolved.push({ input: want.input, why: `search failed: ${r.error}` }); continue; }
        const c = pickCandidate(want.query, r.data);
        if (!c.pick) { unresolved.push({ input: want.input, why: `no stored listing named like "${want.query}"${c.others.length ? ` (search returned ${c.others.slice(0, 3).map((h) => `${h.name} ${h.storeId}`).join(', ')})` : ''}` }); continue; }
        storeId = c.pick.storeId;
        resolved = { ...resolved, query: want.query, ambiguous: c.ambiguous, others: c.others.slice(0, 7) };
      }
      const p = await call(o, `/v1/starter-boards/app-${storeId}`);
      if (p.error) { unresolved.push({ input: want.input, why: `preview failed: ${p.error}${/^404/.test(p.error) ? ' (app not in the stored catalogue)' : ''}` }); continue; }
      if (p.seed?.previewToken) tokens.set(String(p.seed.storeId), p.seed.previewToken);
      const { previewToken, ...seedNoToken } = p.seed ?? {};
      items.push({ resolved, preview: { ...p, seed: p.seed ? seedNoToken : p.seed } });
    } catch (e) {
      if (e instanceof StopError) { console.error(e.message); unresolved.push({ input: want.input, why: 'not read: stopped' }); if (!items.length) throw e; break; }
      throw e;
    }
  }
  return { raw: { tool: 'competitor-seed-shortlist/raw', items, unresolved }, tokens };
}

async function main() {
  const o = parse(process.argv.slice(2));
  if (o.help) { console.log(HELP); return; }
  if (!['md', 'csv', 'json'].includes(o.format)) throw new Error('--format must be md, csv or json');
  let raw, tokens = new Map();
  if (o.file) raw = JSON.parse(await readFile(o.file, 'utf8'));
  else {
    ({ raw, tokens } = await fetchAll(o));
    if (o.save) await writeFile(o.save, JSON.stringify(raw, null, 2));
    console.error(`${calls} API call(s) used.`);
  }
  if (raw?.tool !== 'competitor-seed-shortlist/raw') throw new Error('Expected a file saved with --save.');
  const report = buildReport(raw.items.map((i) => seedReport(i.preview, i.resolved)), raw.unresolved ?? []);
  let d = null;
  if (o.state) {
    const prev = await readFile(o.state, 'utf8').then(JSON.parse).catch(() => null);
    if (prev) { try { d = diff(report, prev); } catch { console.error(`Note: ${o.state} is not a competitor-seed-shortlist report, so no comparison was made. It will be replaced.`); } }
    await writeFile(o.state, JSON.stringify(report, null, 2));
  }
  if (o.format === 'json') console.log(JSON.stringify(report, null, 2));
  else if (o.format === 'csv') console.log(toCsv(report));
  else console.log(toMarkdown(report, d));
  if (o.commands) console.log('\n' + adoptCommands(report, tokens, { skipWeak: !o['keep-weak'], api: o.api }));

  if (o.webhook) {
    const text = toChat(report, d);
    const isDiscord = /discord(app)?\.com\/api\/webhooks/.test(o.webhook);
    const r = await fetch(o.webhook, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(isDiscord ? { content: text.slice(0, 1900) } : { text }) });
    if (!r.ok) throw new Error(`Webhook returned ${r.status}`);
  }
}

main().catch((e) => { console.error(e.message); process.exit(1); });
