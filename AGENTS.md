# AGENTS.md — Na medicínu

The build/test/release contract for this repo. An agent (or the overnight ralph loop) should be
able to read only this file and ship correctly. Keep every command copy-pasteable and current.
Taste rules that apply to every flywheel product live in the hub: `flywheel/docs/standards/taste.md`.

> One-liner: Interactive biology lessons for Czech medical-school entrance prep: spatial models a learner can turn, open part by part and go deeper into.
> Stack/template: web-static (Vite + TS, no framework; lessons are plain HTML + raw WebGL)  ·  Track: pet  ·  Portfolio record: `flywheel/data/products/medicina.json`

**Picking this up?** Read `docs/ROADMAP.md` first (where things stand, what's in flight, the
handoff conventions), then `BACKLOG.md`. Update ROADMAP's **Now** before you end a session.

## Build
```bash
npm ci      # e.g. npm ci   |  pnpm i --frozen-lockfile  |  (rust) –
npm run build        # e.g. npm run build  |  cargo build --release
```

## Test (TDD required; persona-journey test per primary journey)
```bash
npm run typecheck    # e.g. npm run typecheck  |  cargo check
npm test         # e.g. npm test  |  cargo test
npm run e2e   # local: needs Google Chrome (narration is AAC); not in CI yet          # e.g. npx playwright test   (omit if none)
```
Gate: typecheck · test · build must pass (CI is `docs/standards/ci.template.yml`). Block only on these.

Perf/size asks name a number (bundle kB, p95 ms, suite seconds), re-measure each round, stop at
target — "optimize" without a number is not actionable. Multi-finding reviews use the clean-room
split: findings reduced to `file:line · symptom`, a fresh context fixes one at a time, tests after
each fix (see flywheel `skills/flywheel/references/sweep.md`).

## Run / verify a change in the real app
`npm run dev`, open `/` (course home) and `/deleni-bunky/` (the lesson). Sign-in appears only when `.env.local` has the two `VITE_SUPABASE_*` values.   <!-- how to launch + what to look at; the /run skill covers most stacks -->

## Release (the finish line — produces a storefront link)
- **Web** → deploy to `medicina.dravec.org` (`Cloudflare Pages builds `main` through its Git integration; nothing to run`); platform env: `VITE_SUPABASE_URL`,
  `VITE_SUPABASE_PUBLISHABLE_KEY`.
- **Desktop** → signed + notarized DMG on a GitHub Release (`.github/workflows/release.yml`, the
  generalized mac-dir-stat pipeline). Needs the Apple signing + notary secrets on this repo.
- **CLI / skill** → GitHub Release + Homebrew tap / install script.
Adoption is read from GitHub release **download counts** + web KPIs — no extra telemetry needed.

## Analytics (Common Platform)
Vendored client: `src/platform/flywheel-client.ts` (`flywheel-client.ts` or `flywheel.rs`). Fire the shared
taxonomy (`page_view`, `signup_*`, `conversion`, `key_action`, `feedback_given`, `error`). The aha
moment fires `conversion`; set `activation_event: "conversion"` in the portfolio record and the
conversion rate flows into the console with no extra wiring.
Signals contract (flywheel `docs/standards/signals-contract.md`): send only names on
`src/platform/flywheel-events.json` (the contract test fails otherwise; a new name goes to the
flywheel allow-list first), and the deploy runs `scripts/check-analytics.mjs dist`.

## Done means
Green CI · released (URL or notarized GitHub release) · release tag pushed on the shipped commit
(`v<semver>` · `build-<n>` · `deploy-<yyyy-mm-dd>[-n]`, via `~/my-git/flywheel/scripts/release-tag.sh`;
FLYWHEEL-STANDARD §5) · portfolio record updated (stage/gate/links) · storefront link live ·
(outward promotion only after Pavol's sign-off).

## How this repo is laid out

- **A lesson** is content plus one pure `scene()` function: `src/lessons/<slug>/{meta.ts, lesson.ts, …}`, a page stub `<slug>/index.html`, and static files in `public/<slug>/`. To build or revise one, follow `.claude/skills/lesson/SKILL.md` (the method, binding).
- **The kit** (`src/kit/`) is everything a lesson does not write: `types.ts` (the contract), `kit.js` (page, the four lesson steps, spots, cards, narration), `gl.js` (renderer), `start.ts` (wires a lesson to the platform), `contract.test.ts` (checks every lesson against the contract and the house rules, no browser).
- **The platform** (`src/platform/`) is shared by all pages: `progress.ts` (marks, merge by union), `platform.ts` (account control, cloud sync to the fleet `progress` table with app = `medicina`, analytics).
- **Home** lists lessons from every `src/lessons/*/meta.ts`; `access: 'premium'` lessons are listed for members only until Pavol has read them.
- **Checks:** `npm test` (contract over all lessons, each lesson's fact tests, platform) and `node e2e/lesson.mjs <slug>` (generic walk in Chrome; writes `shots/<slug>/`, which must be looked at).
- **Narration:** `node voice/dump.mjs <slug> && voice/build.py <slug>` after any change to a step's name, tip or description; the contract test fails when it is stale.
- **The workbook leads.** Lesson text follows the daughter's school workbook (terms, number of phases). Where a university textbook differs, the workbook's version leads and the other is mentioned in the deeper level.
- **Lessons on request:** a member files a request in the app; `builder/` on the Mac mini builds it with a headless Claude Code session (Max subscription) following the lesson skill, then gates, merges and publishes it. Nothing runs a model at page-view time.
- `docs/SIGNATURE.md` holds the teaching moves; all are `proposed` until Pavol reviews them.
