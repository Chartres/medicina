// Every lesson's card for the home page, in workbook order. A lesson is listed by having a meta.ts.
import type { Meta } from '../kit/types.ts'

const found = import.meta.glob<Meta>('./*/meta.ts', { eager: true, import: 'meta' })
export const LESSONS: Meta[] = Object.values(found).sort((a, b) => a.order - b.order)
