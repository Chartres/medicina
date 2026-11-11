// Is the signed-in user a premium member? The answer comes from `medicina_members`, where row
// level security shows a user only the row with their own e-mail. This only decides what the
// page shows; the database checks membership again on every request and upload.
import { onUser, supabase, type User } from './platform'

const KEY = 'medicina.member' // sessionStorage: the user id that was last confirmed as a member
const asked = new Map<string, Promise<boolean>>()

/** Asked once per browser session for a member; a "no" is asked again on the next page load. */
export function isMember(user: User | null): Promise<boolean> {
  if (!supabase || !user) return Promise.resolve(false)
  try { if (sessionStorage.getItem(KEY) === user.id) return Promise.resolve(true) } catch { /* blocked storage: ask */ }
  let p = asked.get(user.id)
  if (!p) {
    p = Promise.resolve(supabase.from('medicina_members').select('tier').maybeSingle()).then(
      ({ data, error }) => {
        if (error) asked.delete(user.id) // a failed check is not an answer
        const yes = !error && !!data
        if (yes) try { sessionStorage.setItem(KEY, user.id) } catch { /* see above */ }
        return yes
      },
      () => { asked.delete(user.id); return false },
    )
    asked.set(user.id, p)
  }
  return p
}

/** Calls `fn` with the member (or null) now and whenever the signed-in user changes. */
export function onMember(fn: (member: User | null) => void) {
  let seen: string | null | undefined
  onUser((user) => {
    const id = user?.id ?? null
    if (id === seen) return // token refreshes repeat the same user
    seen = id
    if (!user) return fn(null)
    void isMember(user).then((yes) => { if (seen === id) fn(yes ? user : null) })
  })
}
