import { describe, expect, it } from 'vitest'
import { empty, mark, merge, parse, same, summarize, type Manifest } from './progress'

const manifest: Manifest = { explore: ['seen/a', 'seen/b'], depth: ['deep/x'], find: [], name: ['named/a'], order: [] }

describe('progress', () => {
  it('marks once and counts against the lesson manifest', () => {
    const p = empty()
    expect(mark(p, 'bunka/seen/a', '2026-11-10T10:00:00Z')).toBe(true)
    expect(mark(p, 'bunka/seen/a', '2026-11-11T10:00:00Z')).toBe(false)
    expect(p.marks['bunka/seen/a']).toBe('2026-11-10T10:00:00Z')
    expect(summarize(p, 'bunka', manifest)).toEqual({ explore: [1, 2], depth: [0, 1], find: [0, 0], name: [0, 1], order: [0, 0] })
  })

  it('merges two devices by union, in either order, and never loses a mark', () => {
    const ipad = empty(), phone = empty()
    mark(ipad, 'bunka/seen/a', '2026-11-10T10:00:00Z')
    mark(ipad, 'bunka/deep/x', '2026-11-10T10:05:00Z')
    mark(phone, 'bunka/seen/a', '2026-11-09T08:00:00Z')
    mark(phone, 'bunka/named/a', '2026-11-09T08:01:00Z')
    ipad.summary.bunka = summarize(ipad, 'bunka', manifest)
    phone.summary.bunka = summarize(phone, 'bunka', manifest)
    const ab = merge(ipad, phone), ba = merge(phone, ipad)
    expect(ab).toEqual(ba)
    expect(Object.keys(ab.marks).sort()).toEqual(['bunka/deep/x', 'bunka/named/a', 'bunka/seen/a'])
    expect(ab.marks['bunka/seen/a']).toBe('2026-11-09T08:00:00Z')
    expect(ab.summary.bunka.depth).toEqual([1, 1])
    expect(same(ab, ipad)).toBe(false)
    expect(same(merge(ab, ipad), ab)).toBe(true)
  })

  it('starts empty from missing, corrupt or older data instead of throwing', () => {
    for (const raw of [null, undefined, 'x', {}, { version: 0, marks: { a: 't' } }, { version: 1 }]) expect(parse(raw)).toEqual(empty())
    expect(parse({ version: 1, marks: { k: 't' } }).marks).toEqual({ k: 't' })
  })
})
