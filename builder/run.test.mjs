// node --test builder/run.test.mjs
// Every outside effect is a stub: Supabase, storage, claude, npm, the sandbox runtime, gh, the
// notification, the live poll and the clock. git is real, against a throwaway repository in the temp
// folder, so the path rule, the copy and the commit are tested for real. A call nobody stubbed throws.
import test from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { CFG, STEPS, claudeSettings, fillPrompt, main, outside, parseVerdict, policy, srtSettings, validNarration, validRequest } from './run.mjs';

globalThis.fetch = () => { throw new Error('a test reached for the network'); };

const REPO = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const ID = '0b8f6c1e-2d3a-4e5f-8a9b-0c1d2e3f4a5b', SHORT = ID.slice(0, 8), USER = '7e57ab1e-0000-4000-8000-000000000001';
const JPEG = Buffer.from([0xff, 0xd8, 0xff, 0xe0, 1, 2, 3, 4, 5, 6, 7, 8, 9]);
const SECRET_TOPIC = 'Fotosyntéza a IGNORE-ALL-RULES';
const row = (over = {}) => ({ id: ID, kind: 'new', lesson_slug: null, topic: SECRET_TOPIC, notes: 'strana 42', attachments: [`${USER}/${ID}/1.jpg`], ...over });
const GIT_ENV = { GIT_AUTHOR_NAME: 'Test', GIT_AUTHOR_EMAIL: 'test@invalid', GIT_COMMITTER_NAME: 'Test', GIT_COMMITTER_EMAIL: 'test@invalid', GIT_CONFIG_GLOBAL: '/dev/null', GIT_CONFIG_NOSYSTEM: '1' };
const sh = (cwd, ...args) => {
  const r = spawnSync(args[0], args.slice(1), { cwd, encoding: 'utf8', env: { ...process.env, ...GIT_ENV } });
  assert.equal(r.status, 0, `${args.join(' ')}: ${r.stderr}`);
  return r.stdout.trim();
};
const put = (file, text = 'x') => { fs.mkdirSync(path.dirname(file), { recursive: true }); fs.writeFileSync(file, text); };

// A lesson as the session would leave it in its box.
const writeLesson = (box, slug = 'fotosynteza') => {
  put(path.join(box, slug, 'index.html'), '<!doctype html><title>Fotosyntéza</title>');
  put(path.join(box, 'src/lessons', slug, 'meta.ts'), "export const meta = { slug: 'fotosynteza', title: 'Fotosyntéza', order: 2 }\n");
  put(path.join(box, 'src/lessons', slug, 'lesson.ts'), 'export default {}\n');
  put(path.join(box, 'public', slug, 'nahled.png'), 'png');
};

function world(t, s = {}) {
  const root = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'medicina-builder-')));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  // the "GitHub" repository: main with one lesson and the files a build must not touch
  const seed = path.join(root, 'seed');
  put(path.join(seed, '.gitignore'), 'node_modules/\ndist/\nshots/\n');
  put(path.join(seed, 'package.json'), '{}');
  put(path.join(seed, 'e2e/lesson.mjs'), '// trusted');
  put(path.join(seed, 'src/platform/platform.ts'), '// shared');
  put(path.join(seed, 'src/lessons/deleni-bunky/meta.ts'), "export const meta = { title: 'Dělení buňky' }\n");
  put(path.join(seed, 'deleni-bunky/index.html'), '<title>old</title>');
  sh(seed, 'git', 'init', '--quiet', '-b', 'main');
  sh(seed, 'git', 'add', '-A');
  sh(seed, 'git', 'commit', '--quiet', '-m', 'seed');
  const origin = path.join(root, 'origin.git');
  sh(root, 'git', 'clone', '--quiet', '--bare', seed, origin);
  put(path.join(root, 'srt'), '');
  const cfg = { ...CFG, repo: REPO, cache: path.join(root, 'cache'), tmp: path.join(root, 'tmp'), origin, srt: path.join(root, 'srt'), say: '/nonexistent', rounds: 4, env: GIT_ENV };
  const wt = path.join(cfg.cache, 'wt', SHORT), box = path.join(cfg.cache, 'box', SHORT);
  const clock = { t: Date.UTC(2026, 10, 11, 19, 0) };
  const rows = [...(s.rows ?? [])];
  const seen = { sql: [], status: [], runs: [], sessions: [], notes: [], downloads: [], fetches: 0 };
  const names = (prefix) => seen.runs.filter((r) => r.startsWith(prefix));

  const fx = {
    now: () => clock.t,
    sleep: async (ms) => { clock.t += ms; },
    alive: () => s.lockOwnerAlive ?? false,
    sql: async (q) => {
      seen.sql.push(q);
      if (/set status = 'failed'.*status in \('building', 'checking'\)/.test(q)) return (s.stale ?? []).map((id) => ({ id }));
      if (/^select count/.test(q)) return [{ n: String(s.started ?? 0) }];
      if (/set status = 'building'/.test(q) || /^select id, kind/.test(q)) return rows.splice(0, 1);
      const m = q.match(/set status = '(\w+)', status_note = (null|'(?:[^']|'')*'), result_url = (null|'[^']*')(?:, lesson_slug = '([^']*)')? where id = '([0-9a-f-]+)'$/);
      if (m) return seen.status.push({ status: m[1], note: m[2], url: m[3], slug: m[4], id: m[5] }), [];
      throw new Error(`unstubbed sql: ${q}`);
    },
    download: async (object) => { seen.downloads.push(object); return s.photo ?? JPEG; },
    notify: async (text) => { seen.notes.push(text); },
    fetch: async (url) => {
      seen.fetches++;
      if (s.fetch) return s.fetch(url);
      return url.endsWith('build.json') ? { status: 200, text: fs.readFileSync(path.join(wt, 'public/fotosynteza/build.json'), 'utf8') } : { status: 200, text: '<html>' };
    },
    session: async (o) => {
      seen.sessions.push(o);
      return (s.session ?? ((o2) => { writeLesson(o2.cwd); return { code: 0, result: 'Hotovo.\n\nLESSON_SLUG: fotosynteza' }; }))(o, seen.sessions.length);
    },
    run: async (cmd, args, o = {}) => {
      const line = [cmd === cfg.srt ? 'box:' : cmd, ...(cmd === cfg.srt ? args.slice(2) : args)].join(' ');
      seen.runs.push(line);
      if (cmd === 'git') {
        // an http(s) or ssh URL would be the real GitHub: only the local fixture is allowed
        assert.ok(!args.some((a) => /^(https?:|ssh:|git@)/.test(a)), `git reached for the network: ${line}`);
        const r = spawnSync('git', args, { cwd: o.cwd, env: o.env, encoding: 'utf8' });
        return { code: r.status, out: r.stdout + r.stderr, stdout: r.stdout };
      }
      const over = s.run?.(line, o);
      if (over) return over;
      if (cmd === cfg.srt) {
        assert.equal(o.cwd, box, 'sandboxed checks run in the box');
        if (line === 'box: node voice/dump.mjs fotosynteza') put(path.join(o.cwd, 'voice/narration/fotosynteza.json'), JSON.stringify({ slug: 'fotosynteza', pronounce: {}, tracks: { hlavni: [['Krok', 'tip', 'popis']] } }));
        if (line === 'box: npm run build') put(path.join(o.cwd, 'dist/fotosynteza/index.html'), 'built');
        return { code: 0, out: 'ok' };
      }
      assert.equal(o.cwd === wt || cmd === 'gh', true, `${line} must run in the clean worktree`);
      if (line.startsWith('npm ci')) return fs.mkdirSync(path.join(wt, 'node_modules'), { recursive: true }), { code: 0, out: '' };
      if (cmd === 'voice/build.py') return put(path.join(wt, 'public/fotosynteza/audio/timings.json'), '{}'), { code: 0, out: '' };
      if (line.startsWith('node e2e/lesson.mjs')) {
        assert.equal(fs.readFileSync(path.join(wt, 'dist/fotosynteza/index.html'), 'utf8'), 'built', 'e2e sees the build made in the box');
        return put(path.join(wt, 'shots/fotosynteza/desk-0.png'), 'shot'), { code: 0, out: 'ok' };
      }
      if (line.startsWith('gh pr create')) return { code: 0, out: 'https://github.com/Chartres/medicina/pull/7\n' };
      if (line.startsWith('gh api')) return { code: 0, out: sh(origin, 'git', 'diff', '--name-only', 'main', `lesson/${SHORT}`) };
      if (line.startsWith('gh pr view')) return { code: 0, out: `${sh(origin, 'git', 'rev-parse', `lesson/${SHORT}`)} main\n` };
      if (line.startsWith('gh pr checks')) return { code: 0, out: 'gate pass' };
      if (line.startsWith('gh pr merge')) return { code: 0, out: 'merged' };
      throw new Error(`unstubbed call: ${line}`);
    },
  };
  return { fx, cfg, seen, names, root, origin, wt, box, clock, go: (...argv) => main(argv, fx, cfg) };
}

const quiet = (t) => { t.mock.method(console, 'log', () => {}); t.mock.method(console, 'error', () => {}); };
const statuses = (w) => w.seen.status.map((x) => x.status);

test('nothing queued: no session, no notification, the lock is released', async (t) => {
  quiet(t);
  const w = world(t);
  assert.equal(await w.go(), 0);
  assert.equal(w.seen.sessions.length, 0);
  assert.equal(w.seen.notes.length, 0);
  assert.ok(!fs.existsSync(path.join(w.cfg.cache, 'lock')));
});

test('budget: three builds started in 24 h leave the queue alone', async (t) => {
  quiet(t);
  const w = world(t, { rows: [row()], started: 3 });
  assert.equal(await w.go(), 0);
  assert.ok(!w.seen.sql.some((q) => q.includes("set status = 'building'")), 'nothing was claimed');
  assert.match(w.seen.sql.find((q) => q.startsWith('select count')), /updated_at > '2026-11-10T19:00:00.000Z'/);
  assert.equal(w.seen.sessions.length, 0);
});

test('lock: a live owner means do nothing; a dead owner is taken over', async (t) => {
  quiet(t);
  const held = world(t, { rows: [row()], lockOwnerAlive: true });
  put(path.join(held.cfg.cache, 'lock'), '4242');
  assert.equal(await held.go(), 0);
  assert.equal(held.seen.sql.length, 0);
  assert.equal(fs.readFileSync(path.join(held.cfg.cache, 'lock'), 'utf8'), '4242', "the other build's lock is left in place");

  const stale = world(t, { lockOwnerAlive: false });
  put(path.join(stale.cfg.cache, 'lock'), '4242');
  assert.equal(await stale.go(), 0);
  assert.ok(stale.seen.sql.length > 0, 'the run went on');
  assert.ok(!fs.existsSync(path.join(stale.cfg.cache, 'lock')));
});

test('stale building/checking rows older than two hours are failed when no build is alive', async (t) => {
  quiet(t);
  const w = world(t, { stale: [ID] });
  await w.go();
  const q = w.seen.sql[0];
  assert.match(q, /status in \('building', 'checking'\) and updated_at < '2026-11-11T17:00:00.000Z'/);
  assert.match(q, /status_note = 'Stavba se nepovedla\. Pavol o tom ví\.'/);
});

test('happy path: a new lesson is built, checked, merged after green checks, verified live', async (t) => {
  quiet(t);
  let photoSeenBySession;
  const w = world(t, {
    rows: [row()],
    session: (o, n) => {
      const req = JSON.parse(fs.readFileSync(path.join(o.addDir, 'request.json'), 'utf8'));
      photoSeenBySession = req.attachments[0];
      if (n === 1) writeLesson(o.cwd);
      else assert.ok(fs.existsSync(path.join(o.cwd, 'shots/fotosynteza/desk-0.png')), 'the review round gets the screenshots');
      return { code: 0, result: 'LESSON_SLUG: fotosynteza' };
    },
  });
  assert.equal(await w.go(), 0);

  assert.deepEqual(statuses(w), ['checking', 'live']);
  assert.deepEqual(w.seen.status.at(-1), { status: 'live', note: 'null', url: "'https://medicina.dravec.org/fotosynteza/'", slug: 'fotosynteza', id: ID });
  // two session rounds: the build, then the look at the screenshots; the second resumes the first
  assert.equal(w.seen.sessions.length, 2);
  assert.equal(w.seen.sessions[1].resume, true);
  assert.match(w.seen.sessions[1].prompt, /shots\/fotosynteza\//);
  assert.equal(w.seen.sessions[0].cwd, w.box);
  // the prompt names the request file and never carries the request's own words
  assert.ok(w.seen.sessions[0].prompt.includes(path.join(w.cfg.cache, ID, 'request.json')));
  assert.ok(!w.seen.sessions[0].prompt.includes('IGNORE-ALL-RULES'));
  // every check ran, in order, twice (once per round)
  const order = STEPS('fotosynteza').map((s) => (s.where === 'box' ? 'box: ' : '') + s.cmd.join(' '));
  assert.deepEqual(w.seen.runs.filter((r) => order.includes(r)), [...order, ...order]);
  // the pushed commit holds lesson files only
  const pushed = sh(w.origin, 'git', 'diff', '--name-only', 'main', `lesson/${SHORT}`).split('\n');
  assert.deepEqual(outside(pushed, 'fotosynteza'), []);
  assert.ok(pushed.includes('fotosynteza/index.html') && pushed.includes('public/fotosynteza/audio/timings.json') && pushed.includes('public/fotosynteza/build.json') && pushed.includes('voice/narration/fotosynteza.json'));
  assert.match(sh(w.origin, 'git', 'log', '-1', '--format=%B', `lesson/${SHORT}`), /^Lekce: Fotosyntéza\n[^]*Co-Authored-By: Claude <noreply@anthropic\.com>$/);
  // pull request, then checks, then merge: in that order, squash, never --auto
  const gh = w.names('gh pr');
  assert.deepEqual(gh.map((g) => g.split(' ').slice(0, 3).join(' ')), ['gh pr create', 'gh pr view', 'gh pr checks', 'gh pr merge']);
  assert.match(gh[0], /--title Lekce: Fotosyntéza --body [^]*lesson builder[^]*- e2e: ok[^]*🤖 Generated with \[Claude Code\]\(https:\/\/claude\.com\/claude-code\)$/);
  assert.match(gh[2], /^gh pr checks 7 .*--watch/);
  assert.match(gh[3], /^gh pr merge 7 .*--squash --delete-branch --match-head-commit [0-9a-f]{40}$/);
  assert.ok(!w.seen.runs.some((r) => r.includes('--auto')));
  // nothing public carries the request's words or the requester
  assert.ok(!w.seen.runs.some((r) => r.includes('IGNORE-ALL-RULES') || r.includes('strana 42') || r.includes(USER)));
  // one notification, built from fixed words and ids
  assert.deepEqual(w.seen.notes, [`Medicina builder, push this to me now, no planning: request ${SHORT}: lesson fotosynteza is live, https://medicina.dravec.org/fotosynteza/ (PR #7).`]);
  // attachments: downloaded once, outside every repository, never committed, gone after the build
  assert.deepEqual(w.seen.downloads, [`${USER}/${ID}/1.jpg`]);
  assert.equal(photoSeenBySession, path.join(w.cfg.cache, ID, '1.jpg'));
  assert.ok(!photoSeenBySession.startsWith(w.box + path.sep) && !photoSeenBySession.startsWith(w.wt + path.sep));
  assert.ok(!sh(w.origin, 'git', 'ls-tree', '-r', '--name-only', `lesson/${SHORT}`).match(/\.jpe?g|request\.json/));
  assert.ok(!fs.existsSync(path.join(w.cfg.cache, ID)), 'the photos do not outlive the build');
  assert.ok(!fs.existsSync(w.box) && !fs.existsSync(w.wt), 'box and worktree are removed after a good build');
  assert.ok(!fs.existsSync(path.join(w.cfg.cache, 'lock')));
});

test('the session is contained by its settings and never gets skip-permissions', (t) => {
  const p = policy(CFG, { box: '/c/box/x', req: '/c/req' });
  const s = claudeSettings(p);
  assert.equal(s.permissions.defaultMode, 'dontAsk');
  assert.deepEqual(s.sandbox.network, { allowedDomains: ['registry.npmjs.org'], strictAllowlist: true, allowLocalBinding: false });
  assert.equal(s.sandbox.enabled && s.sandbox.failIfUnavailable && s.sandbox.allowUnsandboxedCommands === false, true);
  assert.ok(s.sandbox.filesystem.denyRead.includes('/Users') && s.sandbox.filesystem.denyRead.includes(os.homedir()));
  assert.deepEqual(s.sandbox.filesystem.allowWrite, ['/c/box/x', CFG.tmp, path.join(CFG.cache, 'npm')]);
  assert.ok(s.permissions.allow.includes('Edit(//c/box/x/**)'));
  assert.ok(s.permissions.deny.includes('Read(~/.supabase_pat)'));
  // the sandboxed checks get the same boundary, minus the request folder
  const g = srtSettings(policy(CFG, { box: '/c/box/x' }));
  assert.deepEqual(g.filesystem.allowWrite, s.sandbox.filesystem.allowWrite);
  assert.ok(!g.filesystem.allowRead.includes('/c/req'));
  assert.ok(!fs.readFileSync(path.join(REPO, 'builder/run.mjs'), 'utf8').match(/['"`]--dangerously-skip-permissions|bypassPermissions['"`]/));
});

test('reject line: status rejected with the reason, nothing built, the reason stays out of the notification', async (t) => {
  quiet(t);
  const w = world(t, { rows: [row()], session: () => ({ code: 0, result: "LESSON_REJECT: Tohle není téma z biologie, chemie ani fyziky; it's <b>x</b>" }) });
  assert.equal(await w.go(), 0);
  assert.deepEqual(w.seen.status, [{ status: 'rejected', note: "'Tohle není téma z biologie, chemie ani fyziky; it''s b x /b'", url: 'null', slug: undefined, id: ID }]);
  assert.equal(w.names('box:').length + w.names('gh').length, 0);
  assert.deepEqual(w.seen.notes, [`Medicina builder, push this to me now, no planning: request ${SHORT}: the request was turned down as not a lesson topic.`]);
});

test('session timeout: failed, with a Czech note for the requester and the stage for Pavol', async (t) => {
  quiet(t);
  const w = world(t, { rows: [row()], session: () => ({ code: 143, timedOut: true, result: null }) });
  assert.equal(await w.go(), 1);
  assert.deepEqual(w.seen.status, [{ status: 'failed', note: "'Stavba se nepovedla. Pavol o tom ví.'", url: 'null', slug: undefined, id: ID }]);
  assert.equal(w.seen.sessions[0].timeoutMs, 100 * 60_000);
  assert.match(w.seen.notes[0], /the build failed at "session", log .*\.log\.$/);
  assert.equal(w.names('gh').length, 0);
  assert.ok(!fs.existsSync(path.join(w.cfg.cache, 'lock')));
});

test('a change outside the lesson paths fails the build before anything runs', async (t) => {
  quiet(t);
  for (const stray of ['src/platform/platform.ts', 'package.json', 'builder/run.mjs', '.claude/settings.json', 'e2e/lesson.mjs']) {
    const w = world(t, { rows: [row()], session: (o) => { writeLesson(o.cwd); put(path.join(o.cwd, stray), 'changed'); return { code: 0, result: 'LESSON_SLUG: fotosynteza' }; } });
    assert.equal(await w.go(), 1, stray);
    assert.deepEqual(statuses(w), ['checking', 'failed'], stray);
    assert.equal(w.names('box:').length + w.names('npm').length + w.names('node').length + w.names('gh').length, 0, `${stray}: nothing was run`);
    assert.match(w.seen.notes[0], /failed at "paths"/);
    assert.equal(sh(w.origin, 'git', 'branch', '--list', 'lesson/*'), '', 'nothing was pushed');
  }
});

test('a symlink in the lesson, or a slug that names an existing folder, fails the build', async (t) => {
  quiet(t);
  const link = world(t, { rows: [row()], session: (o) => { writeLesson(o.cwd); fs.symlinkSync('/etc/passwd', path.join(o.cwd, 'public/fotosynteza/leak.txt')); return { code: 0, result: 'LESSON_SLUG: fotosynteza' }; } });
  assert.equal(await link.go(), 1);
  assert.match(link.seen.notes[0], /failed at "paths"/);
  assert.equal(link.names('voice/build.py').length + link.names('node e2e').length + link.names('gh').length, 0, 'no host step ran');

  for (const slug of ['src', 'deleni-bunky', 'node_modules', '../x', 'Fotosynteza']) {
    const w = world(t, { rows: [row()], session: () => ({ code: 0, result: `LESSON_SLUG: ${slug}` }) });
    assert.equal(await w.go(), 1, slug);
    assert.match(w.seen.notes[0], /failed at "session"/, slug);
    assert.equal(w.names('box:').length, 0, slug);
  }
});

test('a failing check sends the session back with the report; still failing after the last round is a failed build', async (t) => {
  quiet(t);
  const w = world(t, { rows: [row()], run: (line) => (line === 'box: npm run test:lessons' ? { code: 1, out: 'AssertionError: 4 !== 5' } : null) });
  assert.equal(await w.go(), 1);
  assert.equal(w.seen.sessions.length, 4, 'cfg.rounds session turns');
  assert.match(w.seen.sessions[1].prompt, /one failed\. The report is in .*checks\.txt/);
  assert.ok(!w.seen.sessions[1].prompt.includes('AssertionError'), 'check output reaches the session as a file, not as prompt text');
  assert.equal(w.names('box: npm run build').length + w.names('node e2e').length, 0, 'later checks do not run after a failure');
  assert.equal(w.names('gh').length, 0);
  assert.deepEqual(statuses(w), ['checking', 'failed']);
  assert.match(w.seen.notes[0], /failed at "checks", work kept in /);
  assert.ok(fs.existsSync(path.join(w.box, 'src/lessons/fotosynteza')), 'the work is kept for a look');
});

test('pull request checks fail: no merge', async (t) => {
  quiet(t);
  const w = world(t, { rows: [row()], run: (line) => (line.startsWith('gh pr checks') ? { code: 1, out: 'gate fail' } : null) });
  assert.equal(await w.go(), 1);
  assert.equal(w.names('gh pr merge').length, 0);
  assert.deepEqual(statuses(w), ['checking', 'failed']);
  assert.match(w.seen.notes[0], /failed at "ci" \(PR #7\), work kept in /);
  assert.equal(w.seen.fetches, 0);
});

test('checks that have not started yet are waited for, not read as a pass or a failure', async (t) => {
  quiet(t);
  let n = 0;
  const w = world(t, { rows: [row()], run: (line) => (line.startsWith('gh pr checks') && ++n < 3 ? { code: 1, out: "no checks reported on the 'lesson/x' branch" } : null) });
  assert.equal(await w.go(), 0);
  assert.equal(w.names('gh pr checks').length, 3);
  assert.equal(w.names('gh pr merge').length, 1);
});

test('the pull request on GitHub must be the commit that was checked, with lesson files only', async (t) => {
  quiet(t);
  const extra = world(t, { rows: [row()], run: (line) => (line.startsWith('gh api') ? { code: 0, out: 'fotosynteza/index.html\n.github/workflows/ci.yml\n' } : null) });
  assert.equal(await extra.go(), 1);
  const moved = world(t, { rows: [row()], run: (line) => (line.startsWith('gh pr view') ? { code: 0, out: `${'a'.repeat(40)} main\n` } : null) });
  assert.equal(await moved.go(), 1);
  for (const w of [extra, moved]) {
    assert.equal(w.names('gh pr checks').length + w.names('gh pr merge').length, 0);
    assert.match(w.seen.notes[0], /failed at "paths" \(PR #7\)/);
  }
});

test('live poll times out: failed, and Pavol is told it was merged', async (t) => {
  quiet(t);
  const w = world(t, { rows: [row()], fetch: async () => ({ status: 200, text: '<html>the old site</html>' }) });
  const t0 = w.clock.t;
  assert.equal(await w.go(), 1);
  assert.equal(w.names('gh pr merge').length, 1);
  assert.ok(w.clock.t - t0 >= 15 * 60_000 && w.clock.t - t0 < 17 * 60_000, 'gave up after about 15 minutes');
  assert.deepEqual(statuses(w), ['checking', 'failed']);
  assert.match(w.seen.notes[0], /failed at "live" \(PR #7\)/);
});

test('revise: only the named lesson, and it must exist', async (t) => {
  quiet(t);
  const other = world(t, { rows: [row({ kind: 'revise', lesson_slug: 'deleni-bunky' })] }); // the stub session writes fotosynteza
  assert.equal(await other.go(), 1);
  assert.match(other.seen.notes[0], /failed at "session"/);
  const ok = world(t, {
    rows: [row({ kind: 'revise', lesson_slug: 'deleni-bunky' })],
    session: (o) => { put(path.join(o.cwd, 'deleni-bunky/index.html'), '<title>new</title>'); return { code: 0, result: 'LESSON_SLUG: deleni-bunky' }; },
    run: (line, o) => {
      if (line === 'box: node voice/dump.mjs deleni-bunky') return put(path.join(o.cwd, 'voice/narration/deleni-bunky.json'), JSON.stringify({ slug: 'deleni-bunky', tracks: {} })), { code: 0, out: '' };
      if (line.startsWith('voice/build.py') || line.startsWith('node e2e')) return { code: 0, out: '' };
      return null;
    },
    fetch: async (url) => ({ status: 200, text: url.endsWith('build.json') ? fs.readFileSync(path.join(ok.wt, 'public/deleni-bunky/build.json'), 'utf8') : '' }),
  });
  assert.equal(await ok.go(), 0);
  assert.equal(ok.seen.status.at(-1).status, 'live');
  assert.match(ok.names('gh pr create')[0], /--title Lekce: Dělení buňky /);
});

test('--dry-run stops before the session and changes no status; --request claims that row and skips the budget', async (t) => {
  quiet(t);
  const dry = world(t, { rows: [row()] });
  assert.equal(await dry.go('--dry-run'), 0);
  assert.equal(dry.seen.sessions.length + dry.seen.notes.length, 0);
  assert.ok(dry.seen.sql.every((q) => q.startsWith('select')), 'read-only');
  assert.ok(fs.existsSync(path.join(dry.cfg.cache, ID, 'request.json')) && fs.existsSync(dry.box) && fs.existsSync(dry.wt));

  const one = world(t, { rows: [row()], started: 99 });
  assert.equal(await one.go('--request', ID), 0);
  assert.match(one.seen.sql.find((q) => q.includes("set status = 'building'")), new RegExp(`where id = '${ID}' and status in \\('queued', 'failed'\\)`));
  assert.equal(one.seen.status.at(-1).status, 'live');
  await assert.rejects(world(t).go('--request', "x'; drop table"), /usage/);
});

test('a queue row is user input', (t) => {
  assert.equal(validRequest(row()).topic, SECRET_TOPIC);
  assert.equal('user_id' in validRequest({ ...row(), user_id: USER, requester: 'somebody' }), false);
  for (const bad of [{ id: 'x' }, { kind: 'delete' }, { topic: 'a'.repeat(201) }, { lesson_slug: '../etc' }, { kind: 'revise' }, { attachments: 'x' }, { attachments: Array(13).fill(`${USER}/${ID}/1.jpg`) },
    { attachments: [`${USER}/${ID}/../../x.jpg`] }, { attachments: [`${USER}/${USER}/1.jpg`] }, { attachments: [`${USER}/${ID}/1.svg`] }])
    assert.throws(() => validRequest(row(bad)), /bad request row/, JSON.stringify(bad));
});

test('an attachment that is not an image fails the build before a session starts', async (t) => {
  quiet(t);
  const w = world(t, { rows: [row()], photo: Buffer.from('<?php system($_GET[0]); ?>') });
  assert.equal(await w.go(), 1);
  assert.equal(w.seen.sessions.length, 0);
  assert.match(w.seen.notes[0], /failed at "attachments"/);
});

test('result line, path rule, narration shape, prompt placeholders', (t) => {
  assert.deepEqual(parseVerdict('text\nLESSON_SLUG: krebsuv-cyklus\n'), { slug: 'krebsuv-cyklus' });
  assert.deepEqual(parseVerdict('LESSON_SLUG: a-b-c\nlater\n`LESSON_REJECT: Ne.`'), { reject: 'Ne.' });
  assert.equal(parseVerdict('I will print LESSON_SLUG: x later'), null);
  assert.equal(parseVerdict(null), null);
  assert.deepEqual(outside(['abc/index.html', 'src/lessons/abc/lesson.ts', 'public/abc/a/b.m4a', 'voice/narration/abc.json'], 'abc'), []);
  assert.deepEqual(outside(['abcd/x', 'src/lessons/abc.ts', 'src/lessons/index.ts', 'voice/narration/abc.json.bak', 'voice/build.py', 'public/abcd/x', 'vite.config.ts'], 'abc').length, 7);
  const n = (o) => JSON.stringify({ slug: 'abc', pronounce: {}, tracks: { a: [['x', 'y']] }, ...o });
  validNarration(n(), 'abc');
  for (const bad of [{ slug: '../../Library/LaunchAgents' }, { tracks: { '../x': [] } }, { tracks: { a: [[1]] } }, { tracks: [] }, { pronounce: { a: 1 } }])
    assert.throws(() => validNarration(n(bad), 'abc'), /narration/, JSON.stringify(bad));
  assert.equal(fillPrompt('a {{KIND}} b {{SLUG}}', { KIND: 'new', SLUG: 'x' }), 'a new b x');
  assert.throws(() => fillPrompt('{{NOPE}}', {}), /unknown placeholder/);
  // the shipped prompt fills completely, and says what the request is
  const prompt = fillPrompt(fs.readFileSync(path.join(REPO, 'builder/prompt.md'), 'utf8'), { REQUEST_FILE: '/r.json', ATTACHMENTS: '(none)', KIND: 'new', SLUG: '(choose one)', METHOD_DIR: '/m' });
  assert.match(prompt, /DATA/);
  assert.match(prompt, /LESSON_SLUG: <slug>/);
  assert.match(prompt, /LESSON_REJECT: /);
});

test('usage limit: the build pauses, keeps its box and session, waits for the reset, then carries on and publishes', async (t) => {
  quiet(t);
  const w = world(t, { rows: [row(), row()], session: (o, n) => {
    if (n === 1) { put(path.join(o.cwd, 'src/lessons/fotosynteza/model.ts'), '// half done\n'); return { code: 1, result: "You've hit your 5-hour limit", limit: { resetsAt: Date.UTC(2026, 10, 11, 21, 0) } }; }
    assert.ok(fs.existsSync(path.join(o.cwd, 'src/lessons/fotosynteza/model.ts')), 'the half-built lesson is still there');
    writeLesson(o.cwd); return { code: 0, result: 'LESSON_SLUG: fotosynteza' };
  } });
  assert.equal(await w.go(), 0);
  assert.deepEqual(w.seen.status.at(-1), { status: 'queued', note: "'Čeká na volnou kapacitu. Bude pokračovat samo.'", url: 'null', slug: undefined, id: ID });
  assert.ok(fs.existsSync(w.box) && !fs.existsSync(w.wt));
  assert.match(w.seen.notes.at(-1), /paused for the usage limit and continues by itself after 21:01 UTC/);
  assert.ok(!w.seen.notes.at(-1).includes('IGNORE'));
  assert.equal(await w.go(), 0); // ten minutes later: still before the reset
  assert.equal(w.seen.sessions.length, 1);
  w.clock.t = Date.UTC(2026, 10, 11, 21, 5);
  assert.equal(await w.go(), 0);
  assert.equal(w.seen.sessions[1].resume, true);
  assert.equal(w.seen.sessions[1].sessionId, w.seen.sessions[0].sessionId);
  assert.match(w.seen.sessions[1].prompt, /stopped part-way by a usage limit/);
  assert.equal(statuses(w).at(-1), 'live');
  assert.ok(!fs.existsSync(path.join(w.cfg.cache, 'resume', `${ID}.json`)));
});
