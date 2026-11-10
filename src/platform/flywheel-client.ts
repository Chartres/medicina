// flywheel-client — the Common Platform SDK (docs/ARCHITECTURE "Common Platform").
// One vendorable file every flywheel app drops in: identity, the shared event
// taxonomy, declarative conversions, feedback, error logging, and magic-link auth,
// all writing to the shared flywheel-core Supabase project. Framework-free; the
// React UI kit (FeedbackWidget, AuthPanel) lives alongside but imports this.
//
// Privacy: cookieless, first-party. visitor_id is an anonymous localStorage UUID;
// flywheel_uid is the cross-product identity, set only after sign-in. The Supabase
// client is created with the *publishable* key (sb_publishable_…, which replaced
// the legacy anon JWT key); it still resolves to the `anon` Postgres role for RLS.

export const TAXONOMY = [
  'page_view',
  'signup_started',
  'signup_completed',
  'conversion',
  'key_action',
  'feedback_given',
  'error',
] as const
export type TaxonomyEvent = (typeof TAXONOMY)[number]

/** Minimal shape of the bits of supabase-js we use — keeps this dep-free + testable. */
export interface SupabaseLike {
  from(table: string): { insert(row: unknown): { then?: (ok: () => void, err: () => void) => void } | Promise<unknown> }
  auth?: {
    signInWithOtp(args: { email: string; options?: unknown }): Promise<unknown>
    signInWithOAuth(args: { provider: string; options?: unknown }): Promise<unknown>
    signOut(): Promise<unknown>
    getUser?(): Promise<{ data: { user: { id: string } | null } }>
    onAuthStateChange?(cb: (event: string, session: { user?: { id: string } } | null) => void): unknown
  }
}

export interface FlywheelClientConfig {
  /** Product slug — the `app` column on every row. */
  app: string
  /** A configured supabase-js client, or null to no-op (local/tests/unconfigured). */
  supabase?: SupabaseLike | null
  storage?: Storage
  /** Injectable clock for tests. */
  now?: () => string
  /** True for automated browsers (CI, audits, Playwright, crawlers). Default: isAutomatedBrowser(navigator). Their events are dropped. */
  isAutomated?: () => boolean
}

export interface EventRow {
  app: string
  event: string
  props: Record<string, unknown>
  visitor_id: string
  session_id: string
  flywheel_uid: string | null
  created_at: string
}

export interface FeedbackRow {
  app: string
  /** Sean Ellis: 'very' | 'somewhat' | 'not' (how disappointed if it went away). */
  sean_ellis: string | null
  /** Optional 0-10 score. */
  score: number | null
  text: string | null
  flywheel_uid: string | null
  visitor_id: string
  created_at: string
}

// Blocked site data (private mode, strict settings): reading window.localStorage throws a
// SecurityError, and getItem/setItem may throw too. Then the ids live in memory for the page's
// lifetime: stable within the visit, never one shared 'anon' id for every such visitor.
const memoryIds = new Map<string, string>()
function memoryId(key: string): string {
  let v = memoryIds.get(key)
  if (!v) {
    v = crypto.randomUUID()
    memoryIds.set(key, v)
  }
  return v
}

/** window.localStorage / sessionStorage, or undefined where reading them throws or they don't exist. */
function globalStorage(name: 'localStorage' | 'sessionStorage'): Storage | undefined {
  try {
    const s = (globalThis as Record<string, unknown>)[name]
    return s ? (s as Storage) : undefined
  } catch {
    return undefined
  }
}

function readId(storage: Storage | undefined, key: string): string {
  try {
    if (!storage) return memoryId(key)
    let v = storage.getItem(key)
    if (!v) {
      v = crypto.randomUUID()
      storage.setItem(key, v)
    }
    return v
  } catch {
    return memoryId(key)
  }
}

export function resolveIds(storage?: Storage): { visitor_id: string; session_id: string } {
  const ls = storage ?? globalStorage('localStorage')
  const ss = globalStorage('sessionStorage') ?? ls
  return {
    visitor_id: readId(ls, 'fw:vid'),
    session_id: readId(ss, 'fw:sid'),
  }
}

export function buildEventRow(
  app: string,
  event: string,
  props: Record<string, unknown>,
  ids: { visitor_id: string; session_id: string },
  flywheel_uid: string | null,
  createdAt: string,
): EventRow {
  return { app, event, props, ...ids, flywheel_uid, created_at: createdAt }
}

export interface FlywheelClient {
  track(event: string, props?: Record<string, unknown>): void
  /** Declarative conversion: fire the canonical 'conversion' event at the aha
   * moment. Set the product's activation_event to 'conversion' and the data
   * flows into flywheel automatically (no per-app KPI wiring). */
  conversion(props?: Record<string, unknown>): void
  /** Tie subsequent events to a cross-product identity (call on sign-in). */
  identify(flywheelUid: string | null): void
  feedback(input: { sean_ellis?: string; score?: number; text?: string }): void
  logError(err: unknown, context?: Record<string, unknown>): void
  signInWithEmail(email: string): Promise<void>
  signInWithGoogle(): Promise<void>
  signOut(): Promise<void>
}

// Headless browsers and crawlers that run JS (Googlebot renders every page with
// fresh storage, so each render looked like a new visitor).
const BOT_UA = /bot\b|crawl|spider|slurp|headless|lighthouse|prerender|pagespeed|googleother|bingpreview|facebookexternalhit|embedly|preview/i

// Real phones whose brand ends in "bot" (Cubot), which BOT_UA would otherwise catch.
const PHONE_UA = /\bcubot\b/i

/** True for browsers that are not a person: webdriver (Playwright, CI) or a bot/headless user agent. */
export function isAutomatedBrowser(nav?: { webdriver?: boolean; userAgent?: string }): boolean {
  if (!nav) return false
  const ua = nav.userAgent ?? ''
  return nav.webdriver === true || (BOT_UA.test(ua) && !PHONE_UA.test(ua))
}

export function createFlywheelClient(config: FlywheelClientConfig): FlywheelClient {
  const { app, supabase = null, storage } = config
  const now = config.now ?? (() => new Date().toISOString())
  const automated = (config.isAutomated ?? (() => isAutomatedBrowser(typeof navigator !== 'undefined' ? navigator : undefined)))()
  let flywheelUid: string | null = null

  const insert = (table: string, row: unknown) => {
    if (!supabase) return // no-op when unconfigured — never breaks the app
    if (automated) return // our own CI/audit browsers are not visitors (KPIs stay honest)
    try {
      const res = supabase.from(table).insert(row)
      // supabase-js returns a thenable; swallow both outcomes (fire-and-forget)
      if (res && typeof (res as { then?: unknown }).then === 'function') {
        ;(res as Promise<unknown>).then(
          () => {},
          () => {},
        )
      }
    } catch {
      // analytics must never throw into the app
    }
  }

  const track: FlywheelClient['track'] = (event, props = {}) => {
    insert('events', buildEventRow(app, event, props, resolveIds(storage), flywheelUid, now()))
  }

  return {
    track,
    conversion: (props = {}) => track('conversion', props),
    identify: (uid) => {
      flywheelUid = uid
    },
    feedback: ({ sean_ellis, score, text } = {}) => {
      const row: FeedbackRow = {
        app,
        sean_ellis: sean_ellis ?? null,
        score: score ?? null,
        text: text ?? null,
        flywheel_uid: flywheelUid,
        visitor_id: resolveIds(storage).visitor_id,
        created_at: now(),
      }
      insert('feedback', row)
      track('feedback_given', { sean_ellis: sean_ellis ?? null })
    },
    logError: (err, context = {}) => {
      const message = err instanceof Error ? err.message : String(err)
      track('error', { message: message.slice(0, 500), ...context })
    },
    signInWithEmail: async (email) => {
      // OTP code + magic link (template includes {{ .Token }}); survives
      // link-prefetch scanners and cross-device opens (docs/research/auth.md).
      await supabase?.auth?.signInWithOtp({ email })
    },
    signInWithGoogle: async () => {
      await supabase?.auth?.signInWithOAuth({ provider: 'google' })
    },
    signOut: async () => {
      await supabase?.auth?.signOut()
      flywheelUid = null
    },
  }
}
