// Competitor seed shortlist for PeekPanda. No dependencies; runs in Node 18+ and in the browser.
// Input per app: the answer of GET /v1/starter-boards/app-<storeId> (MCP starter_boards action detail with an
// app key), optionally with the search hit that resolved the name (GET /v1/starter-boards/search, action search).
// Both reads use stored observations only and never start collection. Nothing here writes a board.

const num = (x) => (typeof x === 'number' && Number.isFinite(x) ? x : null);
const day = (s) => (typeof s === 'string' && s.length >= 10 ? s.slice(0, 10) : null);
const fmt = (n) => (n == null ? 'n/a' : Math.round(n).toLocaleString('en-US'));
const norm = (s) => String(s ?? '').toLowerCase().normalize('NFKD').replace(/[\u0300-\u036f]/g, '').replace(/[^a-z0-9]+/g, ' ').trim();

export const REASONS = {
  shared_searches: 'shared searches',
  similar_listing: 'similar listing',
  similar_description: 'similar description',
  same_category: 'same category, weaker',
};

// "493145008", "id493145008" or an apps.apple.com link -> store ID; anything else is a name to search.
export function parseInput(s) {
  const raw = String(s).trim();
  const [text, label] = raw.split(/\s*=\s*(?=[^/]*$)/);
  const m = text.match(/\/id(\d{3,20})/i) || text.match(/^(?:id)?(\d{3,20})$/i);
  return m ? { input: raw, storeId: m[1], label: label || null } : { input: raw, query: text, label: label || null };
}

// Pick one stored listing from the (at most eight) search hits. An exact name wins, then a name that starts
// with the query, then one that contains it; ties go to the most ratings. Anything else is left unresolved.
export function pickCandidate(query, hits) {
  const q = norm(query);
  const list = (hits ?? []).map((h) => ({ storeId: String(h.storeId), name: h.name ?? String(h.storeId), developer: h.developer ?? null, category: h.category ?? null, ratingCount: num(h.ratingCount) }));
  // "Headspace: Sleep & Meditation" and "Babbel - Language Learning" count as an exact "Headspace" / "Babbel".
  const base = (name) => norm(String(name ?? '').split(/\s*(?::|\s[-–—|]\s)\s*/)[0]);
  const tier = (h) => { const n = norm(h.name); return n === q || base(h.name) === q ? 0 : n.startsWith(q) ? 1 : n.includes(q) ? 2 : 9; };
  const ranked = list.map((h) => ({ ...h, tier: tier(h) })).filter((h) => h.tier < 9).sort((a, b) => a.tier - b.tier || (b.ratingCount ?? -1) - (a.ratingCount ?? -1));
  const pick = ranked[0] ?? null;
  return { pick, others: list.filter((h) => h.storeId !== pick?.storeId), ambiguous: ranked.length > 1 && ranked[1].tier === pick.tier };
}

const appFacts = (a) => ({
  storeId: String(a.storeId), name: a.name ?? String(a.storeId), developer: a.developer ?? null, category: a.category ?? null,
  rating: num(a.rating), ratingCount: num(a.ratingCount), listingObservedAt: day(a.listingObservedAt),
  liveAds: num(a.liveAds), totalAds: num(a.totalAds), paidObservedAt: day(a.paidObservedAt),
  keywords: (a.keywords ?? []).map((k) => ({ keyword: k.keyword, rank: num(k.rank), popularity: num(k.popularity) })),
  keywordsTotal: num(a.keywordsTotal),
});

// One seeded preview -> the seed app and its potential competitors, in the order seed.matches returns them.
export function seedReport(p, resolved = {}) {
  if (!p || !Array.isArray(p.apps)) throw new Error('Expected the answer of GET /v1/starter-boards/app-<storeId> (an object with an "apps" array).');
  if (!p.seed || typeof p.seed !== 'object') throw new Error(`"${p.key}" is a curated niche (seed is null). Use an app-<storeId> key.`);
  const byId = new Map(p.apps.map((a) => [String(a.storeId), appFacts(a)]));
  const seedId = String(p.seed.storeId);
  const seed = byId.get(seedId) ?? { storeId: seedId, name: seedId, keywords: [] };
  const seedKw = new Set(seed.keywords.map((k) => norm(k.keyword)));
  const rivals = (Array.isArray(p.seed.matches) ? p.seed.matches : []).map((m, i) => {
    const a = byId.get(String(m.storeId)) ?? { storeId: String(m.storeId), name: String(m.storeId), keywords: [] };
    return { ...a, position: i + 1, reason: m.matchReason ?? null, sharedSearches: num(m.sharedSearches), sharedPreviewKeywords: a.keywords.filter((k) => seedKw.has(norm(k.keyword))).map((k) => k.keyword) };
  });
  return {
    input: resolved.input ?? seedId, label: resolved.label ?? null, query: resolved.query ?? null, ambiguous: !!resolved.ambiguous,
    otherHits: resolved.others ?? [], key: p.key ?? `app-${seedId}`, seed, rivals,
    hasPreviewToken: typeof p.seed.previewToken === 'string' && p.seed.previewToken.length > 0,
  };
}

// Several seeds -> one report, with rivals that show up for two or more of your apps.
export function buildReport(seeds, unresolved = [], now = new Date()) {
  const own = new Set(seeds.map((s) => s.seed.storeId));
  const seen = new Map();
  for (const s of seeds) for (const r of s.rivals) {
    const e = seen.get(r.storeId) ?? { storeId: r.storeId, name: r.name, liveAds: r.liveAds, paidObservedAt: r.paidObservedAt, seeds: [], reasons: [] };
    e.seeds.push(s.seed.name); e.reasons.push(r.reason); seen.set(r.storeId, e);
  }
  const shared = [...seen.values()].filter((e) => e.seeds.length > 1).sort((a, b) => b.seeds.length - a.seeds.length || (b.liveAds ?? -1) - (a.liveAds ?? -1));
  for (const s of seeds) for (const r of s.rivals) r.alsoYourApp = own.has(r.storeId);
  return { tool: 'competitor-seed-shortlist', generatedAt: now.toISOString().slice(0, 10), seeds, unresolved, shared, uniqueRivals: seen.size };
}

// Compare with an earlier report: rivals that joined or left each seed's preview, reason and count moves.
export function diff(report, prev) {
  if (prev?.tool !== 'competitor-seed-shortlist') throw new Error('not a competitor-seed-shortlist report');
  const before = new Map(prev.seeds.map((s) => [s.seed.storeId, s]));
  const out = { since: prev.generatedAt, newSeeds: [], goneSeeds: [], joined: [], left: [], reasonMoves: [], searchMoves: [], adMoves: [] };
  for (const s of report.seeds) {
    const p = before.get(s.seed.storeId);
    if (!p) { out.newSeeds.push(s.seed.name); continue; }
    const pr = new Map(p.rivals.map((r) => [r.storeId, r]));
    const nr = new Set(s.rivals.map((r) => r.storeId));
    for (const r of s.rivals) {
      const q = pr.get(r.storeId);
      if (!q) { out.joined.push({ seed: s.seed.name, name: r.name, storeId: r.storeId, reason: r.reason }); continue; }
      if (q.reason !== r.reason) out.reasonMoves.push({ seed: s.seed.name, name: r.name, from: q.reason, to: r.reason });
      if (q.sharedSearches != null && r.sharedSearches != null && q.sharedSearches !== r.sharedSearches) out.searchMoves.push({ seed: s.seed.name, name: r.name, from: q.sharedSearches, to: r.sharedSearches, delta: r.sharedSearches - q.sharedSearches });
      if (q.liveAds != null && r.liveAds != null && q.liveAds !== r.liveAds) out.adMoves.push({ seed: s.seed.name, name: r.name, from: q.liveAds, to: r.liveAds, delta: r.liveAds - q.liveAds });
    }
    for (const q of p.rivals) if (!nr.has(q.storeId)) out.left.push({ seed: s.seed.name, name: q.name, storeId: q.storeId, reason: q.reason });
  }
  const now = new Set(report.seeds.map((s) => s.seed.storeId));
  out.goneSeeds = prev.seeds.filter((s) => !now.has(s.seed.storeId)).map((s) => s.seed.name);
  for (const k of ['searchMoves', 'adMoves']) out[k].sort((a, b) => Math.abs(b.delta) - Math.abs(a.delta));
  return out;
}

const sgn = (n) => (n > 0 ? '+' : n < 0 ? '−' : '') + fmt(Math.abs(n));
const reason = (r) => REASONS[r] ?? r ?? 'no reason given';

export function diffLines(d, max = 6) {
  const L = [];
  for (const j of d.joined.slice(0, max)) L.push(`${j.seed}: new potential competitor ${j.name} (${reason(j.reason)})`);
  for (const j of d.left.slice(0, max)) L.push(`${j.seed}: ${j.name} no longer in the preview`);
  for (const m of d.reasonMoves.slice(0, max)) L.push(`${m.seed}: ${m.name} match reason ${reason(m.from)} → ${reason(m.to)}`);
  for (const m of d.searchMoves.slice(0, max)) L.push(`${m.seed}: ${m.name} shared searches ${fmt(m.from)} → ${fmt(m.to)} (${sgn(m.delta)})`);
  for (const m of d.adMoves.slice(0, max)) L.push(`${m.seed}: ${m.name} live ads ${fmt(m.from)} → ${fmt(m.to)} (${sgn(m.delta)})`);
  for (const n of d.newSeeds) L.push(`new app in your list: ${n}`);
  for (const n of d.goneSeeds) L.push(`no longer in your list: ${n}`);
  return L;
}

const ads = (a) => (a.liveAds == null ? 'never collected' : `${fmt(a.liveAds)} / ${fmt(a.totalAds)}${a.paidObservedAt ? ` (${a.paidObservedAt})` : ''}`);
const rating = (a) => (a.rating == null ? 'n/a' : `${a.rating.toFixed(2)} (${fmt(a.ratingCount)})`);

export function toMarkdown(report, d = null) {
  const o = [`## Competitor seed shortlist`, '', `${report.seeds.length} app(s) seeded on ${report.generatedAt}, ${report.uniqueRivals} distinct potential competitor(s).`, ''];
  o.push('_Potential competitors come from PeekPanda\'s seeded starter preview: up to five stored iOS apps ranked from shared keyword searches, listing names, descriptions and category. "Same category" is a weaker match, not proof of direct competition. Live ads are stored ad-library counts with the date they were observed; keywords are the five the preview shows per app, not the full list._', '');
  if (d) {
    o.push(`### Since the last check (${d.since})`, '');
    const L = diffLines(d, 8);
    o.push(...(L.length ? L.map((l) => `- ${l}`) : ['- no changes in the potential competitors']), '');
  }
  for (const s of report.seeds) {
    const a = s.seed;
    o.push(`### ${a.name} (${a.storeId})${s.label ? ` — ${s.label}` : ''}`, '');
    if (s.query) o.push(`Resolved "${s.query}" by search${s.ambiguous ? `; **ambiguous**, other matches: ${s.otherHits.slice(0, 4).map((h) => `${h.name} (${h.storeId})`).join(', ')}. Pass the store ID to pin one.` : '.'}`, '');
    o.push(`${a.developer ?? 'unknown developer'} · ${a.category ?? 'no category'} · rating ${rating(a)} · live / total ads ${ads(a)}`, '');
    if (!s.rivals.length) { o.push('No potential competitors in the preview (sparse evidence gives a smaller preview).', ''); continue; }
    o.push('| # | Potential competitor | Why | Shared searches | Rating | Live / total ads | Preview keywords in common |', '|---|---|---|---|---|---|---|');
    for (const r of s.rivals) o.push(`| ${r.position} | ${r.name} (${r.storeId})${r.alsoYourApp ? ' *(also in your list)*' : ''} | ${reason(r.reason)} | ${r.sharedSearches == null ? '–' : fmt(r.sharedSearches)} | ${rating(r)} | ${ads(r)} | ${r.sharedPreviewKeywords.join(', ') || '–'} |`);
    o.push('');
  }
  if (report.shared.length) {
    o.push('### Showing up for more than one of your apps', '');
    for (const e of report.shared) o.push(`- ${e.name} (${e.storeId}): ${e.seeds.join(', ')}`);
    o.push('');
  }
  if (report.unresolved.length) {
    o.push('### Not seeded', '');
    for (const u of report.unresolved) o.push(`- ${u.input}: ${u.why}`);
    o.push('');
  }
  return o.join('\n').trimEnd();
}

export function toCsv(report) {
  const q = (x) => (x == null ? '' : /[",\n]/.test(String(x)) ? `"${String(x).replace(/"/g, '""')}"` : x);
  const head = ['seed_store_id', 'seed_name', 'position', 'store_id', 'name', 'developer', 'category', 'match_reason', 'shared_searches', 'rating', 'rating_count', 'live_ads', 'total_ads', 'paid_observed_at', 'preview_keywords_in_common', 'also_your_app'];
  const rows = report.seeds.flatMap((s) => s.rivals.map((r) => [s.seed.storeId, s.seed.name, r.position, r.storeId, r.name, r.developer, r.category, r.reason, r.sharedSearches, r.rating, r.ratingCount, r.liveAds, r.totalAds, r.paidObservedAt, r.sharedPreviewKeywords.join('; '), r.alsoYourApp ? 'yes' : '']));
  return [head, ...rows].map((r) => r.map(q).join(',')).join('\n');
}

export function toChat(report, d) {
  const L = d ? diffLines(d, 4) : [];
  const head = `PeekPanda potential competitors, ${report.generatedAt}: ${report.seeds.map((s) => `${s.seed.name}: ${s.rivals.slice(0, 3).map((r) => r.name).join(', ') || 'none'}`).join(' | ')}`;
  return [head, ...(d ? [L.length ? `Since ${d.since}:` : `Since ${d.since}: no changes.`, ...L.map((l) => `• ${l}`)] : [])].join('\n');
}

// Adopt commands (POST /v1/starter-boards/app-<storeId>/adopt, scope content:write) for the caller to run, never run here.
// The preview token binds the displayed set for 24 hours; it is printed only at run time and never saved.
export function adoptCommands(report, tokens, { skipWeak = true, api = 'https://api.peekpanda.com' } = {}) {
  return report.seeds.map((s) => {
    const ids = [s.seed.storeId, ...s.rivals.filter((r) => !(skipWeak && r.reason === 'same_category')).map((r) => r.storeId)].slice(0, 6);
    const token = tokens.get(s.seed.storeId);
    const body = JSON.stringify(token ? { selectedStoreIds: ids, previewToken: token } : { selectedStoreIds: ids });
    return `# ${s.seed.name}: ${ids.length} app(s)${token ? ', preview token valid 24 h from this run' : ', no preview token (re-run without --file)'}\ncurl --request POST '${api}/v1/starter-boards/app-${s.seed.storeId}/adopt' \\\n  --header "Authorization: Bearer $PEEKPANDA_TOKEN" \\\n  --header 'content-type: application/json' \\\n  --data '${body}'`;
  }).join('\n\n');
}
