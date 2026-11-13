// node --test builder/skill-sync.test.mjs — git is real against a throwaway repository; gh, the session and the notification are stubs.
import test from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { CFG } from './run.mjs';
import { parseSkillVerdict, skillSync } from './skill-sync.mjs';
import { readSources, writeLock } from './method.mjs';

globalThis.fetch = () => { throw new Error('a test reached for the network'); };
const REPO = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const GIT_ENV = { GIT_AUTHOR_NAME: 'Test', GIT_AUTHOR_EMAIL: 'test@invalid', GIT_COMMITTER_NAME: 'Test', GIT_COMMITTER_EMAIL: 'test@invalid', GIT_CONFIG_GLOBAL: '/dev/null', GIT_CONFIG_NOSYSTEM: '1' };
const sh = (cwd, ...args) => { const r = spawnSync(args[0], args.slice(1), { cwd, encoding: 'utf8', env: { ...process.env, ...GIT_ENV } }); assert.equal(r.status, 0, `${args.join(' ')}: ${r.stderr}`); return r.stdout.trim(); };
const put = (file, text) => { fs.mkdirSync(path.dirname(file), { recursive: true }); fs.writeFileSync(file, text); };
const SKILL = '.claude/skills/lesson/SKILL.md';
const PRIVATE = 'Calm pages with a lot of quiet space around the one strong thing that the reader came here for today, always.\n';

function world(t, session) {
  const root = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'skill-sync-')));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const seed = path.join(root, 'seed'), home = path.join(root, 'home');
  put(path.join(seed, SKILL), '# Building a lesson\nA tip is one sentence.\n' + 'The method, line after line. '.repeat(30) + '\n');
  put(path.join(seed, 'src/kit/types.ts'), 'export interface Step { tip: string }\n');
  put(path.join(seed, 'README.md'), 'readme\n');
  put(path.join(seed, '.claude/skills/lesson/sources.json'), JSON.stringify({ sources: [
    { id: 'contract', path: 'src/kit/types.ts', governs: 'the contract' },
    { id: 'taste', path: '~/taste.md', private: true, governs: 'taste' },
  ] }));
  put(path.join(home, 'taste.md'), PRIVATE);
  writeLock(seed, readSources(seed, home), '2026-11-01');
  sh(seed, 'git', 'init', '--quiet', '-b', 'main'); sh(seed, 'git', 'add', '-A'); sh(seed, 'git', 'commit', '--quiet', '-m', 'seed');
  const origin = path.join(root, 'origin.git'); sh(root, 'git', 'clone', '--quiet', '--bare', seed, origin);
  const cfg = { ...CFG, repo: REPO, cache: path.join(root, 'cache'), tmp: path.join(root, 'tmp'), origin, env: GIT_ENV };
  fs.mkdirSync(cfg.cache, { recursive: true });
  const seen = { sessions: [], gh: [], notes: [], merged: null };
  const fx = {
    now: () => Date.UTC(2026, 10, 11, 20, 0), sleep: async () => {},
    run: async (cmd, args, { cwd, env } = {}) => {
      if (cmd === 'git') { const r = spawnSync('git', args, { cwd, encoding: 'utf8', env: { ...env, ...GIT_ENV } }); return { code: r.status, out: r.stdout + r.stderr, stdout: r.stdout }; }
      if (cmd !== 'gh') throw new Error(`unstubbed program: ${cmd}`);
      seen.gh.push(args.slice(0, 2).join(' '));
      const out = (o) => ({ code: 0, out: o, stdout: o });
      if (args[1] === 'create') return out('https://github.com/x/y/pull/7\n');
      if (args[0] === 'api') return out(sh(origin, 'git', 'diff', '--name-only', 'main', 'skill-sync') + '\n');
      if (args[1] === 'view') return out(`${sh(origin, 'git', 'rev-parse', 'skill-sync')} main\n`);
      if (args[1] === 'checks') return out('gate pass\n');
      if (args[1] === 'merge') { seen.merged = args.at(-1); return out(''); }
      throw new Error(`unstubbed gh ${args.join(' ')}`);
    },
    session: async (o) => { seen.sessions.push(o); return { code: 0, result: session(o.cwd, o) }; },
    notify: async (text) => { seen.notes.push(text); },
  };
  const change = () => { put(path.join(seed, 'src/kit/types.ts'), 'export interface Step { tip: string; short?: string }\n'); sh(seed, 'git', 'commit', '--quiet', '-am', 'contract'); sh(seed, 'git', 'push', '--quiet', origin, 'main'); };
  return { cfg, fx, seen, home, origin, change, root };
}

test('nothing changed: no session, nothing pushed', async (t) => {
  const w = world(t, () => assert.fail('no session expected'));
  assert.equal(await skillSync({ fx: w.fx, cfg: w.cfg, log: () => {}, home: w.home }), 'in line');
  assert.deepEqual(w.seen.gh, []);
});

test('a changed source: a session without shell or web edits the skill; the lock moves; merged on green; Pavol is told in fixed words', async (t) => {
  const w = world(t, (box) => { fs.appendFileSync(path.join(box, 'SKILL.md'), 'A step may carry a short label.\n'); return 'done\nSKILL_UPDATED: steps may carry a short label (contract).'; });
  w.change();
  assert.equal(await skillSync({ fx: w.fx, cfg: w.cfg, log: () => {}, home: w.home }), 'updated');
  const s = w.seen.sessions[0];
  assert.equal(s.tools, 'Read,Edit,Write,Glob,Grep');
  assert.match(s.prompt, /Changed this time: contract\./);
  assert.match(fs.readFileSync(path.join(w.cfg.cache, 'logs/skill-sync.settings.json'), 'utf8'), /"failIfUnavailable": true/);
  assert.equal(sh(w.origin, 'git', 'diff', '--name-only', 'main', 'skill-sync'), `${SKILL}\n.claude/skills/lesson/sources.lock.json`.split('\n').sort().join('\n'));
  assert.match(sh(w.origin, 'git', 'show', `skill-sync:${SKILL}`), /short label/);
  assert.equal(w.seen.merged, sh(w.origin, 'git', 'rev-parse', 'skill-sync'));
  assert.deepEqual(w.seen.notes, ['Medicina builder, push this to me now, no planning: the lesson skill was updated after changes in contract (PR #7).']);
  assert.ok(fs.existsSync(path.join(w.cfg.cache, 'method-prev/contract.ts')) && !fs.existsSync(path.join(w.cfg.cache, 'box/skill')));
});

test('no change needed: only the lock moves', async (t) => {
  const w = world(t, () => 'SKILL_UNCHANGED: an optional label does not change how a lesson is written.');
  w.change();
  assert.equal(await skillSync({ fx: w.fx, cfg: w.cfg, log: () => {}, home: w.home }), 'unchanged');
  assert.equal(sh(w.origin, 'git', 'diff', '--name-only', 'main', 'skill-sync'), '.claude/skills/lesson/sources.lock.json');
});

test('a session that touches anything else, copies a private passage, or gives no verdict publishes nothing; the same change is not retried at once', async (t) => {
  for (const [session, why] of [
    [(box) => { fs.writeFileSync(path.join(box, 'README.md'), 'hijacked\n'); return 'SKILL_UPDATED: x'; }, /something other than the skill/],
    [(box) => { fs.appendFileSync(path.join(box, 'SKILL.md'), PRIVATE); return 'SKILL_UPDATED: x'; }, /copies a passage from the private source "taste"/],
    [(box) => { fs.appendFileSync(path.join(box, SKILL), 'edited in place\n'); return 'SKILL_UPDATED: x'; }, /something other than the skill/],
    [() => 'SKILL_UPDATED: I changed nothing', /said SKILL_UPDATED but the skill did not change/],
    [() => 'I am done.', /without SKILL_UPDATED/],
  ]) {
    const w = world(t, session);
    w.change();
    await assert.rejects(skillSync({ fx: w.fx, cfg: w.cfg, log: () => {}, home: w.home }), why);
    assert.deepEqual(w.seen.gh, []);
    assert.equal(spawnSync('git', ['-C', w.origin, 'rev-parse', '--verify', 'skill-sync'], { env: { ...process.env, ...GIT_ENV } }).status, 128); // nothing pushed
    assert.equal(await skillSync({ fx: w.fx, cfg: w.cfg, log: () => {}, home: w.home }), 'waiting to retry');
    assert.equal(w.seen.sessions.length, 1);
  }
});

test('the verdict is the last matching line', () => {
  assert.deepEqual(parseSkillVerdict('SKILL_UNCHANGED: a\ntext\n`SKILL_UPDATED: b`'), { updated: true, why: 'b' });
  assert.equal(parseSkillVerdict('nothing'), null);
});
