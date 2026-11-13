// Keeps .claude/skills/lesson/SKILL.md in line with what it is derived from.
//
// Runs at the start of every builder invocation (every 10 minutes). When a source listed in
// sources.json differs from sources.lock.json on main, a contained session reads the old and new
// text and edits the skill; this script then checks the result, re-locks, and merges on green.
// The session has no shell and no web access: it can read the sources and edit one file.
//
//   node builder/skill-sync.mjs           run one sync now (same as the builder does)
//   node builder/skill-sync.mjs --lock    after editing the skill by hand: record the working checkout's
//                                         sources as what the skill is in line with (writes the lock file)
import { randomUUID } from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { drift, pack, quoted, readLock, readSources, remember, writeLock } from './method.mjs';
import { CFG, claudeSettings, envsFor, fillPrompt, policy, realFx } from './run.mjs';

const SKILL = '.claude/skills/lesson/SKILL.md', LOCK = '.claude/skills/lesson/sources.lock.json';
// The session edits a working copy at the top of its box: Claude Code guards everything under .claude/
// against edits, and the first real run was refused there. The script puts the result in place.
const COPY = 'SKILL.md';
const RETRY_MS = 6 * 3600_000; // after a failed attempt, leave the same change alone this long
const oneLine = (s, n) => String(s).replace(/[\u0000-\u001f\u007f<>`]/g, ' ').replace(/\s+/g, ' ').trim().slice(0, n);

export function parseSkillVerdict(text) {
  const m = [...String(text ?? '').matchAll(/^\s*`?SKILL_(UPDATED|UNCHANGED):\s*(.+?)`?\s*$/gm)].at(-1);
  return m ? { updated: m[1] === 'UPDATED', why: oneLine(m[2], 300) } : null;
}

export async function skillSync({ fx, cfg = CFG, log = console.log, home }) {
  const c = cfg.cache, dir = { repo: path.join(c, 'repo.git'), wt: path.join(c, 'wt', 'skill'), box: path.join(c, 'box', 'skill'), req: path.join(c, 'skill-req'), prev: path.join(c, 'method-prev'), tried: path.join(c, 'skill-sync.tried') };
  const { env, sessionEnv } = envsFor(cfg);
  const must = async (cmd, args, o = {}) => {
    const r = await fx.run(cmd, args, { env, ...o });
    if (r.code !== 0) throw new Error(`${cmd} ${args.slice(0, 5).join(' ')} exited ${r.code}: ${String(r.out).split('\n').slice(-5).join(' | ')}`);
    return (r.stdout ?? r.out).trim();
  };
  const git = (where, ...args) => must('git', ['-C', where, '-c', 'core.hooksPath=/dev/null', '-c', 'core.fsmonitor=false', ...args]);
  const gh = (...args) => must('gh', args, { cwd: c });
  const clean = async () => { for (const d of [dir.wt, dir.box, dir.req]) fs.rmSync(d, { recursive: true, force: true }); await fx.run('git', ['-C', dir.repo, 'worktree', 'prune'], { env }); };

  if (!fs.existsSync(dir.repo)) await must('git', ['clone', '--quiet', '--bare', cfg.origin, dir.repo]);
  await git(dir.repo, 'fetch', '--quiet', '--prune', cfg.origin, '+refs/heads/main:refs/heads/main');
  const base = await git(dir.repo, 'rev-parse', 'refs/heads/main');
  await clean();
  await git(dir.repo, 'worktree', 'add', '--quiet', '--no-track', '-B', 'skill-sync', dir.wt, base);
  try {
    const sources = readSources(dir.wt, home), changed = drift(sources, readLock(dir.wt));
    if (!changed.length) return 'in line';
    const mark = changed.join(',') + '@' + base;
    if (fs.existsSync(dir.tried) && fs.readFileSync(dir.tried, 'utf8') === mark && fx.now() - fs.statSync(dir.tried).mtimeMs < RETRY_MS) return 'waiting to retry';
    fs.writeFileSync(dir.tried, mark);
    log(`skill sync: sources changed: ${changed.join(', ')}`);

    await must('git', ['clone', '--quiet', '--no-hardlinks', dir.repo, dir.box]);
    await git(dir.box, 'checkout', '--quiet', '--detach', base);
    const before = fs.readFileSync(path.join(dir.wt, SKILL), 'utf8');
    fs.writeFileSync(path.join(dir.box, COPY), before);
    fs.mkdirSync(dir.req, { recursive: true });
    const method = path.dirname(pack(sources, path.join(dir.req, 'method'), { changed, prevDir: dir.prev }));
    const settings = path.join(c, 'logs', 'skill-sync.settings.json');
    fs.mkdirSync(path.dirname(settings), { recursive: true }); fs.mkdirSync(cfg.tmp, { recursive: true });
    fs.writeFileSync(settings, JSON.stringify(claudeSettings(policy(cfg, { box: dir.box, req: dir.req })), null, 1));
    const prompt = fillPrompt(fs.readFileSync(path.join(cfg.repo, 'builder/skill-sync.md'), 'utf8'), { METHOD_DIR: method, CHANGED: changed.join(', ') });
    // No Bash, no WebFetch, no WebSearch: this session reads Pavol's private standards, so it gets no way to send anything anywhere.
    const s = await fx.session({ prompt, cwd: dir.box, settings, addDir: dir.req, sessionId: randomUUID(), resume: false, model: cfg.model, env: sessionEnv, log: path.join(c, 'logs', 'skill-sync.session.jsonl'), timeoutMs: 30 * 60_000, tools: 'Read,Edit,Write,Glob,Grep' });
    const verdict = parseSkillVerdict(s.result);
    if (!verdict) throw new Error(`the session ended without SKILL_UPDATED or SKILL_UNCHANGED (exit ${s.code})`);

    const st0 = await fx.run('git', ['-C', dir.wt, '--no-optional-locks', '-c', 'core.fsmonitor=false', `--work-tree=${dir.box}`, 'status', '--porcelain=v1', '-z', '--untracked-files=all', '--no-renames'], { env });
    if (st0.code !== 0) throw new Error('git status failed');
    const touched = st0.stdout.split('\0').filter(Boolean).map((e) => e.slice(3)); // "XY path"; not trimmed, X may be a space
    if (touched.some((f) => f !== COPY)) throw new Error(`the session changed something other than the skill: ${touched.filter((f) => f !== COPY).slice(0, 5).join(', ')}`);
    const st = fs.lstatSync(path.join(dir.box, COPY), { throwIfNoEntry: false });
    if (!st?.isFile() || st.size > 200_000 || st.size < 500) throw new Error('the skill is no longer a plain file of sane size');
    const text = fs.readFileSync(path.join(dir.box, COPY), 'utf8');
    const edited = text !== before;
    if (edited !== verdict.updated) throw new Error(`the session said ${verdict.updated ? 'SKILL_UPDATED' : 'SKILL_UNCHANGED'} but the skill ${edited ? 'changed' : 'did not change'}`);
    if (edited) {
      const copied = quoted(text, sources);
      if (copied) throw new Error(`the new skill copies a passage from the private source "${copied.source}"; nothing was published`);
      fs.writeFileSync(path.join(dir.wt, SKILL), text);
    }
    writeLock(dir.wt, sources, new Date(fx.now()).toISOString().slice(0, 10));
    await git(dir.wt, 'add', SKILL, LOCK);
    const title = edited ? `Lesson skill: brought in line with ${changed.join(', ')}` : `Lesson skill: checked against ${changed.join(', ')}, no change needed`;
    await git(dir.wt, 'commit', '--quiet', '-m', `${title}\n\n${verdict.why}\n\nCo-Authored-By: Claude <noreply@anthropic.com>`);
    const sha = await git(dir.wt, 'rev-parse', 'HEAD');
    await git(dir.wt, 'push', '--quiet', cfg.origin, '+HEAD:refs/heads/skill-sync');
    const prArgs = ['--repo', cfg.github, '--head', 'skill-sync'];
    const body = `The sources the lesson skill is derived from changed (${changed.join(', ')}); \`builder/skill-sync.mjs\` had a session with no shell and no web access bring the skill in line.\n\n${verdict.why}\n\n🤖 Generated with [Claude Code](https://claude.com/claude-code)`;
    const created = await fx.run('gh', ['pr', 'create', ...prArgs, '--base', 'main', '--title', title, '--body', body], { cwd: c, env });
    const pr = Number((created.code === 0 ? created.out : await gh('pr', 'list', ...prArgs, '--state', 'open', '--json', 'url', '-q', '.[0].url')).match(/\/pull\/(\d+)/)?.[1]);
    if (!pr) throw new Error('no pull request was created');
    const files = (await gh('api', '--paginate', `repos/${cfg.github}/pulls/${pr}/files`, '--jq', '.[].filename')).split('\n').filter(Boolean);
    const head = await gh('pr', 'view', String(pr), '--repo', cfg.github, '--json', 'headRefOid,baseRefName', '-q', '.headRefOid + " " + .baseRefName');
    if (!files.length || files.some((f) => f !== SKILL && f !== LOCK) || head !== `${sha} main`) throw new Error(`pull request #${pr} is not the commit that was checked`);
    let ci; // never `gh pr merge --auto`: with no required checks it merges at once
    for (let waited = 0; ; waited += 15_000) {
      ci = await fx.run('gh', ['pr', 'checks', String(pr), '--repo', cfg.github, '--watch', '--interval', '15'], { cwd: c, env, timeoutMs: 40 * 60_000 });
      if (ci.code === 0 || !/no checks reported/i.test(ci.out) || waited >= 180_000) break;
      await fx.sleep(15_000);
    }
    if (ci.code !== 0) throw new Error(`checks on #${pr} did not pass`);
    await gh('pr', 'merge', String(pr), '--repo', cfg.github, '--squash', '--delete-branch', '--match-head-commit', sha);
    remember(sources, dir.prev);
    fs.rmSync(dir.tried, { force: true });
    log(`skill sync: ${edited ? 'skill updated' : 'no change needed'} (#${pr})`);
    // fixed words, source ids from our own list and a number: no model output goes to the notification rail
    await fx.notify(`Medicina builder, push this to me now, no planning: the lesson skill was ${edited ? 'updated' : 'checked and needed no change'} after changes in ${changed.join(', ')} (PR #${pr}).`).catch(() => {});
    return edited ? 'updated' : 'unchanged';
  } finally {
    await clean();
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  if (process.argv.includes('--lock')) {
    const sources = readSources(CFG.repo);
    writeLock(CFG.repo, sources, new Date().toISOString().slice(0, 10));
    remember(sources, path.join(CFG.cache, 'method-prev'));
    console.log(`locked ${sources.filter((s) => s.hash).length} sources; commit ${LOCK}`);
  } else console.log(await skillSync({ fx: realFx(), cfg: CFG }));
}
