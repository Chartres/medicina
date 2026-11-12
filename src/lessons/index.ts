// Every lesson's card for the home page, in workbook order. A lesson is listed by having a meta.json.
import type { Meta } from '../kit/types.ts'

// meta.json, not code: this list is read by pages that hold the sign-in, and a lesson's code is never run there
const found = import.meta.glob<Meta>('./*/meta.json', { eager: true, import: 'default' })
export const LESSONS: Meta[] = Object.values(found).sort((a, b) => a.order - b.order)
