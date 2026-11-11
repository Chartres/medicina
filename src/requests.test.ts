import { describe, expect, it } from 'vitest'
import {
  CAP_MESSAGE, STATUS_LABEL, attachmentPath, capReached, fitSize, isFinal, safeUrl, shouldPoll, statusLine, validate, type LessonRequest, type Status,
} from './requests'

const req = (over: Partial<LessonRequest> = {}): LessonRequest => ({
  id: 'r1', kind: 'new', lesson_slug: null, topic: 'Mitóza', status: 'queued', status_note: null, result_url: null,
  created_at: '2026-11-11T18:00:00Z', ...over,
})
const img = (name = 'strana.jpg') => ({ name, type: 'image/jpeg' })
const SITE = 'https://medicina.dravec.org'

describe('validate', () => {
  it('accepts a topic alone', () => expect(validate({ topic: 'Mitóza', notes: '', files: [] })).toBeNull())
  it('wants a topic of 3 to 200 characters, counted without the spaces around it', () => {
    expect(validate({ topic: '  ab  ', notes: '', files: [] })).toBe('Téma musí mít aspoň 3 znaky.')
    expect(validate({ topic: '', notes: '', files: [] })).toBe('Téma musí mít aspoň 3 znaky.')
    expect(validate({ topic: 'x'.repeat(201), notes: '', files: [] })).toBe('Téma může mít nejvýš 200 znaků.')
    expect(validate({ topic: 'x'.repeat(200), notes: '', files: [] })).toBeNull()
  })
  it('caps the notes at 4000 characters', () => {
    expect(validate({ topic: 'Mitóza', notes: 'x'.repeat(4000), files: [] })).toBeNull()
    expect(validate({ topic: 'Mitóza', notes: 'x'.repeat(4001), files: [] })).toBe('Popis může mít nejvýš 4000 znaků.')
  })
  it('takes up to 8 files, images only', () => {
    expect(validate({ topic: 'Mitóza', notes: '', files: Array.from({ length: 8 }, () => img()) })).toBeNull()
    expect(validate({ topic: 'Mitóza', notes: '', files: Array.from({ length: 9 }, () => img()) })).toBe('Fotek může být nejvýš 8.')
    expect(validate({ topic: 'Mitóza', notes: '', files: [img(), { name: 'sesit.pdf', type: 'application/pdf' }] })).toBe('Soubor sesit.pdf není obrázek.')
  })
})

describe('attachmentPath', () => {
  it('is <uid>/<request id>/<n>.jpg, the shape the storage policy accepts', () => {
    const uid = '0b0e4a52-6f0c-4f0e-9b7a-1c2d3e4f5a6b', id = '9f8e7d6c-5b4a-4c3d-8e2f-1a0b9c8d7e6f'
    const p = attachmentPath(uid, id, 7)
    expect(p).toBe(`${uid}/${id}/7.jpg`)
    // the same expression as in supabase/migrations/20261111_medicina_requests.sql
    expect(p).toMatch(new RegExp(`^${uid}/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/[0-7]\\.jpg$`))
  })
})

describe('fitSize', () => {
  it('scales the longest side down to 2200 and keeps the shape', () => {
    expect(fitSize(4400, 3300)).toEqual([2200, 1650])
    expect(fitSize(3024, 4032)).toEqual([1650, 2200])
  })
  it('never enlarges', () => expect(fitSize(800, 600)).toEqual([800, 600]))
})

describe('status in words', () => {
  it('has a Czech label for every status', () => {
    expect(STATUS_LABEL).toEqual({ queued: 'Ve frontě', building: 'Staví se', checking: 'Kontroluje se', live: 'Hotovo', failed: 'Nepovedlo se', rejected: 'Zamítnuto' })
  })
  it('a live request links to the lesson', () => {
    expect(statusLine(req({ status: 'live', result_url: '/meioza/' }), SITE)).toEqual({ label: 'Hotovo', note: null, link: '/meioza/' })
  })
  it('a live request without a usable address shows no link', () => {
    expect(statusLine(req({ status: 'live', result_url: 'javascript:alert(1)' }), SITE).link).toBeNull()
    expect(statusLine(req({ status: 'live' }), SITE).link).toBeNull()
  })
  it('failed and rejected carry the note; other states never do', () => {
    expect(statusLine(req({ status: 'failed', status_note: 'Fotky nejdou přečíst.' }), SITE)).toEqual({ label: 'Nepovedlo se', note: 'Fotky nejdou přečíst.', link: null })
    expect(statusLine(req({ status: 'rejected', status_note: 'Tohle téma už lekci má.' }), SITE).note).toBe('Tohle téma už lekci má.')
    expect(statusLine(req({ status: 'building', status_note: 'interní', result_url: '/x/' }), SITE)).toEqual({ label: 'Staví se', note: null, link: null })
  })
})

describe('safeUrl', () => {
  it('keeps an address on this site, as a path', () => {
    expect(safeUrl('/meioza/', SITE)).toBe('/meioza/')
    expect(safeUrl('https://medicina.dravec.org/meioza/?v=2#faze', SITE)).toBe('/meioza/?v=2#faze')
  })
  it('drops everything that leaves the site or is not an address', () => {
    for (const bad of ['//evil.example/x', '/\\evil.example/x', '/\t/evil.example', 'https://evil.example/meioza/', 'http://medicina.dravec.org/', 'https://medicina.dravec.org.evil.example/', 'javascript:alert(1)', 'data:text/html,x', '', null])
      expect(safeUrl(bad, SITE), String(bad)).toBeNull()
  })
})

describe('polling', () => {
  const all: Status[] = ['queued', 'building', 'checking', 'live', 'failed', 'rejected']
  it('live, failed and rejected are final', () => {
    expect(all.filter(isFinal)).toEqual(['live', 'failed', 'rejected'])
  })
  it('runs while any request is still moving', () => {
    expect(shouldPoll([req({ status: 'live' }), req({ status: 'checking' })])).toBe(true)
    expect(shouldPoll([req({ status: 'queued' })])).toBe(true)
  })
  it('stops when all are final or there are none', () => {
    expect(shouldPoll([req({ status: 'live' }), req({ status: 'failed' }), req({ status: 'rejected' })])).toBe(false)
    expect(shouldPoll([])).toBe(false)
  })
})

describe('daily cap', () => {
  const now = Date.parse('2026-11-11T20:00:00Z')
  const at = (iso: string) => req({ created_at: iso })
  it('is reached with 3 requests in the last 24 hours, whatever became of them', () => {
    expect(capReached([at('2026-11-11T19:00:00Z'), at('2026-11-11T08:00:00Z'), req({ created_at: '2026-11-10T20:00:01Z', status: 'failed' })], now)).toBe(true)
  })
  it('is not reached with 2, or when the third is older than 24 hours', () => {
    expect(capReached([at('2026-11-11T19:00:00Z'), at('2026-11-11T08:00:00Z')], now)).toBe(false)
    expect(capReached([at('2026-11-11T19:00:00Z'), at('2026-11-11T08:00:00Z'), at('2026-11-10T19:59:59Z')], now)).toBe(false)
  })
  it('says so in the agreed words', () => expect(CAP_MESSAGE).toBe('Dnes už jsou zadané tři lekce. Další půjde zadat zítra.'))
})
