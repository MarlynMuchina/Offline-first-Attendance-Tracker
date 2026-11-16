import { classBreakdown, mapLimited, ALL_CLASSES } from './schoolOverview'

const row = (id, classId, rate, absent = 0) => ({ student: { id, class_id: classId }, rate, absent })

describe('classBreakdown', () => {
  const classes = [{ id: 'A', name: 'Form 2 North' }, { id: 'B', name: 'Form 3 Mars' }]

  test('averages each class and counts students below both lines', () => {
    const rows = [row('1', 'A', 1, 0), row('2', 'A', 0.6, 4), row('3', 'A', 0.68, 3), row('4', 'B', 0.9, 1)]
    const [a, b] = classBreakdown(rows, classes, 0.7, 2 / 3)
    expect(a).toMatchObject({ id: 'A', name: 'Form 2 North', students: 3, belowWarning: 2, belowExam: 1, absences: 7 })
    expect(a.rate).toBeCloseTo((1 + 0.6 + 0.68) / 3)
    expect(b).toMatchObject({ students: 1, rate: 0.9, belowWarning: 0, belowExam: 0 })
  })

  test('a class with no marked days has no rate', () => {
    const [, b] = classBreakdown([row('1', 'A', 1), row('2', 'B', null)], classes, 0.7, 2 / 3)
    expect(b).toMatchObject({ students: 1, rate: null, belowWarning: 0 })
  })

  test('uses a value no class id can have', () => {
    expect(ALL_CLASSES).toBe('ALL')
  })
})

describe('mapLimited', () => {
  test('keeps the order and never runs more than the limit at once', async () => {
    let running = 0
    let peak = 0
    const out = await mapLimited([1, 2, 3, 4, 5], 2, async (n) => {
      running += 1
      peak = Math.max(peak, running)
      await new Promise((r) => setTimeout(r, 5 * (6 - n)))
      running -= 1
      return n * 10
    })
    expect(out).toEqual([10, 20, 30, 40, 50])
    expect(peak).toBe(2)
  })

  test('handles an empty list', async () => {
    expect(await mapLimited([], 3, async () => 1)).toEqual([])
  })
})
