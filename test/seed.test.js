import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { parseInput, pickCandidate, seedReport, buildReport, diff, toCsv, toMarkdown, toChat, adoptCommands } from '../seed.js';

const load = (f) => JSON.parse(readFileSync(new URL(`../examples/${f}`, import.meta.url)));
const NOW = new Date('2026-11-21T10:00:00Z');
const build = (raw) => buildReport(raw.items.map((i) => seedReport(i.preview, i.resolved)), raw.unresolved, NOW);
const report = build(load('run.json'));

test('parseInput reads IDs, links, names and labels', () => {
  assert.deepEqual(parseInput('493145008'), { input: '493145008', storeId: '493145008', label: null });
  assert.equal(parseInput('id570060128').storeId, '570060128');
  assert.equal(parseInput('https://apps.apple.com/us/app/calm/id571800810').storeId, '571800810');
  assert.deepEqual(parseInput('1459969523=our app'), { input: '1459969523=our app', storeId: '1459969523', label: 'our app' });
  assert.equal(parseInput('Headspace').query, 'Headspace');
});

test('pickCandidate prefers the exact base name with the most ratings and flags ties', () => {
  const hits = [
    { storeId: '300244538', name: 'Headspace', ratingCount: 10 },
    { storeId: '493145008', name: 'Headspace: Sleep & Meditation', ratingCount: 973730 },
    { storeId: '515118602', name: 'Headspace Care (Ginger)', ratingCount: 1933 },
  ];
  const c = pickCandidate('headspace', hits);
  assert.equal(c.pick.storeId, '493145008');
  assert.equal(c.ambiguous, true);
  assert.equal(c.others.length, 2);
  assert.equal(pickCandidate('Babbel', [{ storeId: '1', name: 'Babbel - Language Learning', ratingCount: 5 }]).ambiguous, false);
  assert.equal(pickCandidate('zzz', hits).pick, null);
});

test('seedReport keeps the returned order, reasons and preview keywords in common', () => {
  const s = report.seeds[0];
  assert.equal(s.seed.name, 'Example Sleep Coach');
  assert.deepEqual(s.rivals.map((r) => r.storeId), ['1000000011', '1000000013', '1000000012', '1000000004']);
  assert.equal(s.rivals[0].sharedSearches, 42);
  assert.equal(s.rivals[2].sharedSearches, null);
  assert.deepEqual(s.rivals[0].sharedPreviewKeywords, ['white noise']);
  assert.equal(s.rivals[3].alsoYourApp, true);
  assert.throws(() => seedReport({ key: 'calorie-tracking', seed: null, apps: [] }));
});

test('buildReport lists rivals shared by several of your apps', () => {
  assert.equal(report.uniqueRivals, 6);
  assert.deepEqual(report.shared.map((e) => e.storeId), ['1000000013']);
  assert.equal(report.unresolved.length, 1);
});

test('diff finds joined, left, reason, shared-search and live-ad moves', () => {
  const d = diff(report, build(load('previous-raw.json')));
  assert.deepEqual(d.joined.map((j) => j.name), ['Example Dream Journal', 'Example Budget']);
  assert.deepEqual(d.left.map((j) => j.name), ['Example Old Rival']);
  assert.equal(d.reasonMoves[0].to, 'shared_searches');
  assert.equal(d.searchMoves[0].delta, 4);
  assert.equal(d.adMoves[0].delta, 15);
  assert.deepEqual(d.newSeeds, ['Example Budget']);
  assert.deepEqual(d.goneSeeds, ['Example Gone App']);
  assert.throws(() => diff(report, { tool: 'other' }));
});

test('outputs: markdown, csv, chat and adopt commands', () => {
  const md = toMarkdown(report);
  assert.match(md, /Showing up for more than one of your apps/);
  assert.match(md, /never collected/);
  const csv = toCsv(report).split('\n');
  assert.equal(csv.length, 1 + 7);
  assert.match(csv[0], /^seed_store_id,seed_name,position/);
  assert.match(toChat(report, null), /Example Sleep Coach: Example Rain Sounds/);
  const cmd = adoptCommands(report, new Map([['1000000001', 'TOKEN']]));
  assert.match(cmd, /"previewToken":"TOKEN"/);
  assert.doesNotMatch(cmd.split('\n\n')[0], /1000000004"\]/); // same-category match left out
  assert.match(adoptCommands(report, new Map(), { skipWeak: false }), /"1000000004","1000000021"/);
});
