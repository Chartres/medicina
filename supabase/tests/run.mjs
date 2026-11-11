#!/usr/bin/env node
// Runs medicina_requests.test.sql on the fleet project through the Supabase Management API and
// exits non-zero when an expectation fails. The SQL rolls itself back (it always ends in an
// exception that carries the results), so a run leaves nothing behind.
//
//   node supabase/tests/run.mjs
//
// Needs a Supabase personal access token: SUPABASE_PAT, else ~/.supabase_pat. Never printed.
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'

const REF = process.env.SUPABASE_PROJECT_REF || 'chgwirzbpspoaoposuwg'
const MARK = 'MEDICINA_REQUESTS_TEST '

/** The results array out of the error text the API returns, or null when the script died before reporting. */
export function parseResults(message) {
  const at = message.indexOf(MARK)
  if (at < 0) return null
  const json = message.slice(at + MARK.length).split('\nCONTEXT:')[0].trim()
  try { return JSON.parse(json) } catch { return null }
}

async function main() {
  let pat = process.env.SUPABASE_PAT
  if (!pat) try { pat = fs.readFileSync(path.join(os.homedir(), '.supabase_pat'), 'utf8') } catch { /* reported below */ }
  if (!pat?.trim()) { console.error('No Supabase token (SUPABASE_PAT or ~/.supabase_pat).'); process.exit(2) }
  const sql = fs.readFileSync(new URL('./medicina_requests.test.sql', import.meta.url), 'utf8')
  const res = await fetch(`https://api.supabase.com/v1/projects/${REF}/database/query`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${pat.trim()}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ query: sql }),
  })
  const body = await res.text()
  let message = body
  try { message = JSON.parse(body).message ?? body } catch { /* not JSON: use as is */ }
  const results = parseResults(message)
  if (!results) { console.error(`The test did not report (HTTP ${res.status}):\n${message.slice(0, 2000)}`); process.exit(2) }
  for (const r of results) console.log(`${r.pass ? 'pass' : 'FAIL'}  ${r.label}${r.pass ? '' : `\n      want /${r.want}/\n      got  ${r.got}`}`)
  const failed = results.filter((r) => !r.pass).length
  console.log(`\n${results.length - failed} of ${results.length} passed`)
  process.exit(failed ? 1 : 0)
}

if (import.meta.url === `file://${process.argv[1]}`) await main()
