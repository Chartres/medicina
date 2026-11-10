// The course, in the order of the workbook it follows. A lesson appears here when it is live.
export interface Lesson { slug: string; title: string; chapter: string; blurb: string; image: string }

export const LESSONS: Lesson[] = [
  {
    slug: 'deleni-bunky',
    chapter: 'Základní biologické principy',
    title: 'Buněčný cyklus a dělení buněk',
    blurb: 'G₁, S a G₂, mitóza a meióza na modelu, který si otočíš. Kdy se zdvojí DNA, co se rozchází v anafázi a proč jsou čtyři buňky po meióze každá jiná.',
    image: '/deleni-bunky/nahled.png',
  },
]
