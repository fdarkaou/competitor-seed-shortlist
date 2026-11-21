# competitor-seed-shortlist

Turn a list of your iOS apps into a competitor shortlist: for each app, up to five potential competitors with the reason they matched, how many searches they share, their rating and their live paid ads.

[PeekPanda](https://peekpanda.com) can seed a starter preview with one stored iOS app (`GET /v1/starter-boards/app-<storeId>`). The answer puts the app first, then up to five distinct stored iOS apps ranked from shared keyword searches, listing names, descriptions and category, and `seed.matches` says why each one is there: `shared_searches`, `similar_listing`, `similar_description` or `same_category`. This tool takes a list of apps by name, store ID or App Store link, resolves names with `GET /v1/starter-boards/search`, seeds each app, and prints one table per app plus the competitors that show up for more than one of your apps. With `--state` it tells you next week which competitors joined or left.

Why the name lookup matters: on 2026-11-21 a search for "Headspace" returned a 10-rating productivity app called exactly "Headspace" next to "Headspace: Sleep & Meditation" (973,730 ratings). Picking the exact name would have seeded mind-map apps as competitors. The tool counts the part before a colon or dash as the name, picks the listing with the most ratings, and marks the result **ambiguous** with the other hits so you can pin a store ID. Seeded properly, Headspace's potential competitors were Insight Timer, Calm, Balance, Breethe and Aura, all on shared searches (66 to 78 each); Calm's list included Headspace back, and Duolingo's was Babbel, Falou, Learna, Busuu and Memrise. Live paid ads among those ranged from 0 (Insight Timer, Breethe, Memrise) to 1,525 (Calm), with ad observation dates mostly from 2026-10-22, which is why the table prints the date next to each count.

```
## Competitor seed shortlist

2 app(s) seeded on 2026-11-21, 6 distinct potential competitor(s).

_Potential competitors come from PeekPanda's seeded starter preview: up to five stored iOS apps ranked from shared keyword searches, listing names, descriptions and category. "Same category" is a weaker match, not proof of direct competition. Live ads are stored ad-library counts with the date they were observed; keywords are the five the preview shows per app, not the full list._

### Example Sleep Coach (1000000001) — our sleep app

Example Co · Health & Fitness · rating 4.70 (48,000) · live / total ads 120 / 900 (2026-11-18)

| # | Potential competitor | Why | Shared searches | Rating | Live / total ads | Preview keywords in common |
|---|---|---|---|---|---|---|
| 1 | Example Rain Sounds (1000000011) | shared searches | 42 | 4.60 (21,000) | 45 / 300 (2026-11-18) | white noise |
| 2 | Example Calm Breath (1000000013) | shared searches | 35 | 4.80 (9,000) | 12 / 40 (2026-11-05) | sleep sounds |
| 3 | Example Dream Journal (1000000012) | similar description | – | 4.40 (3,200) | never collected | – |
| 4 | Example Budget (1000000004) *(also in your list)* | same category, weaker | – | 4.80 (90,000) | 60 / 300 (2026-11-18) | – |

### Example Budget (1000000004)

Resolved "Example Budget" by search.

Example Co · Finance · rating 4.80 (90,000) · live / total ads 60 / 300 (2026-11-18)

| # | Potential competitor | Why | Shared searches | Rating | Live / total ads | Preview keywords in common |
|---|---|---|---|---|---|---|
| 1 | Example Envelopes (1000000021) | shared searches | 28 | 4.60 (12,000) | 55 / 120 (2026-11-18) | budget |
...
```

Node 18+, no dependencies, read-only: neither read starts collection, and nothing is adopted. There is also a [browser version](https://fdarkaou.github.io/competitor-seed-shortlist/) that reads pasted JSON and never sends anything anywhere.

## Run it

```sh
export PEEKPANDA_TOKEN=...                          # a PeekPanda API key (scope context:read). Never commit it.
node cli.js --apps "Headspace,Calm,Duolingo"        # names: 2 calls each (search + preview)
node cli.js --apps "493145008,id571800810"          # store IDs: 1 call each
node cli.js --apps "1459969523=our app"             # =Label names the app in the report
node cli.js --apps-file my-apps.txt --format csv > shortlist.csv
node cli.js --apps-file my-apps.txt --save run.json # keep the raw answers; later: node cli.js --file run.json
```

Options: `--apps` (comma-separated, up to 20), `--apps-file` (one per line, `#` comments), `--state path` (weekly diff), `--webhook url` (Slack or Discord), `--format md|csv|json`, `--commands`, `--keep-weak`, `--tenancy` (only a workspace id if you need one; leave it out otherwise, because a key pinned to a workspace answers 403 `workspace_not_accessible` for a tenancy it cannot reach). Every call counts toward your plan's daily API and MCP allowance (Peek 30, Panda 1,000, reset 00:00 UTC; see [plans and refreshes](https://peekpanda.com/docs/plans-and-refreshes)), so pass store IDs once you know them. On `daily_call_limit` the tool stops and reports the apps it already read; one `Retry-After` retry is made on `rate_limited` or 503.

## What the columns mean

- **Why** is `seed.matches[].matchReason` as returned. Same category is a weaker match, not proof of direct competition (PeekPanda's own wording), and it is shown as such.
- **Shared searches** is the nullable shared-search count PeekPanda returns with each match; `–` means none was given. The rows keep PeekPanda's order, which is not simply sorted by this number.
- **Live / total ads** are the app's stored ad-library counts with the date the paid ads were last observed. "never collected" means the count is null, which is not the same as zero. This tool never reports spend, reach or performance.
- **Preview keywords in common** compares the five keywords the preview shows for each app with the seed's five. It is a slice, not a keyword gap; often empty because the top keywords are brand terms.
- **Showing up for more than one of your apps** lists competitors seeded by two or more apps in your list; a competitor that is itself in your list is marked.
- With `--state` a second run lists competitors that joined or left each app's preview, match-reason changes, shared-search moves and live-ad moves, plus apps added to or dropped from your list.

## Turning a shortlist into a board (optional, not run)

`--commands` prints, per app, the `POST /v1/starter-boards/app-<storeId>/adopt` curl line ([docs](https://peekpanda.com/docs/starter-boards-adopt)) with the app and its competitors as `selectedStoreIds` and this run's `seed.previewToken`. That call needs `content:write` and writes a real board, so the tool only prints it; you decide whether to run it. The preview token binds the shown set for 24 hours, is printed only at run time and is never written to `--save` or `--state` files. Same-category matches are left out unless `--keep-weak`. Peek adopts one app; Panda may adopt the set within its remaining tracked-app allowance (409 `tracked_app_limit` otherwise).

## Run it every week (GitHub Actions)

`.github/workflows/seed-watch.yml` runs every Monday, keeps the state file in the Actions cache and posts changes to a webhook. It is off until you set the repository variable `ENABLE_SEED_SHORTLIST=true`. Set `SEED_APPS` to comma-separated store IDs (one call per app per run). Secrets: `PEEKPANDA_TOKEN`, optionally `SEED_WATCH_WEBHOOK_URL`. Read-only.

## Use it from an AI agent (MCP)

The PeekPanda MCP server at `https://mcp.peekpanda.com/mcp` exposes the same reads ([tool reference](https://peekpanda.com/docs/mcp-tools)): the `starter_boards` tool with action `search` and `{"query": {"query": "Headspace"}}`, then action `detail` with `{"params": {"nicheKey": "app-493145008"}}`. Clients sign in with OAuth (scopes `context:read`, and `content:write` only if they adopt) or send an API key as a bearer token on the same URL ([get started](https://peekpanda.com/docs/mcp), [OAuth reference](https://peekpanda.com/docs/mcp-oauth)). Either way you need a PeekPanda account, and tokens stay in your client, never in this repo. The `adopt_starter_board` tool writes a board and is not used here.

## About PeekPanda

PeekPanda is an iOS competitor catalogue where every app has a case file of dated, stored evidence. This sample uses only reads listed in its [API docs](https://peekpanda.com/docs/starter-boards-preview).

## Licence

MIT. Example data in `examples/` is made up.
