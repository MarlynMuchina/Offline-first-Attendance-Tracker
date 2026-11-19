import { trendTakeaway, weekdayTakeaway, splitTakeaway, rankTakeaway } from './takeaways'

describe('trendTakeaway', () => {
  test('says the direction and the weakest week', () => {
    const weekly = [
      { weekStart: '2026-05-04', rate: 0.9 },
      { weekStart: '2026-05-11', rate: 0.85 },
      { weekStart: '2026-05-18', rate: 0.94 },
    ]
    expect(trendTakeaway(weekly, (w) => `w/c ${w}`)).toBe(
      'Up from 90% to 94% between the first and last week. Weakest week: w/c 2026-05-11 (85%).'
    )
  })
  test('down, steady, one week and none', () => {
    expect(trendTakeaway([{ weekStart: 'a', rate: 0.9 }, { weekStart: 'b', rate: 0.8 }])).toMatch(/^Down from 90% to 80%/)
    expect(trendTakeaway([{ weekStart: 'a', rate: 0.9 }, { weekStart: 'b', rate: 0.901 }])).toMatch(/^Steady at about 90%/)
    expect(trendTakeaway([{ weekStart: 'a', rate: 0.9 }])).toBe('Only one week in this range, at 90%.')
    expect(trendTakeaway([])).toBe('')
  })
})

describe('weekdayTakeaway', () => {
  test('names the weakest and strongest day', () => {
    const days = [
      { day: 'Monday', rate: 0.92 }, { day: 'Tuesday', rate: 0.95 }, { day: 'Wednesday', rate: 0.93 },
      { day: 'Thursday', rate: 0.94 }, { day: 'Friday', rate: 0.88 },
    ]
    expect(weekdayTakeaway(days)).toBe('Friday is the weakest day (88%) and Tuesday the strongest (95%).')
  })
  test('says when the days are about the same, and skips empty data', () => {
    expect(weekdayTakeaway([{ day: 'Monday', rate: 0.91 }, { day: 'Friday', rate: 0.915 }])).toMatch(/about the same/)
    expect(weekdayTakeaway([{ day: 'Monday', rate: null }])).toBe('')
  })
})

describe('splitTakeaway', () => {
  test('gives each share', () => {
    const split = [
      { status: 'PRESENT', count: 88, share: 0.88 },
      { status: 'LATE', count: 4, share: 0.04 },
      { status: 'ABSENT', count: 8, share: 0.08 },
    ]
    expect(splitTakeaway(split)).toBe('88% of marks are present, 4% late and 8% absent.')
    expect(splitTakeaway(split.map((x) => ({ ...x, count: 0, share: 0 })))).toBe('')
  })
})

describe('rankTakeaway', () => {
  test('highest, lowest and how many are below the line', () => {
    const rows = [{ label: 'Form 2 North', value: 0.91 }, { label: 'Form 3 East', value: 0.65 }, { label: 'Form 1', value: null }]
    expect(rankTakeaway(rows, 0.7)).toBe('Form 2 North is highest (91%) and Form 3 East lowest (65%). 1 class is below the 70% warning line.')
    expect(rankTakeaway([{ label: 'A', value: 0.6 }, { label: 'B', value: 0.5 }], 0.7, 'school')).toMatch(/2 schools are below/)
    expect(rankTakeaway([{ label: 'A', value: 0.95 }], 0.7, 'school')).toBe('A is at 95%. Every school is above the 70% warning line.')
    expect(rankTakeaway([], 0.7)).toBe('')
  })
})
