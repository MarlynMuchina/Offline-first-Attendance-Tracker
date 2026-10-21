import { greetingFor, formatDay, initials, weeklyRates } from './display.js'

describe('greetingFor', () => {
  it('follows the time of day', () => {
    expect(greetingFor(new Date(2026, 9, 21, 7, 30))).toBe('Good morning')
    expect(greetingFor(new Date(2026, 9, 21, 12, 0))).toBe('Good afternoon')
    expect(greetingFor(new Date(2026, 9, 21, 16, 59))).toBe('Good afternoon')
    expect(greetingFor(new Date(2026, 9, 21, 17, 0))).toBe('Good evening')
  })

  it('uses the current time by default', () => {
    expect(['Good morning', 'Good afternoon', 'Good evening']).toContain(greetingFor())
  })
})

describe('formatDay', () => {
  it('writes a stored date out in words', () => {
    expect(formatDay('2026-05-04')).toBe('4 May 2026')
  })

  it('says when a date is missing', () => {
    expect(formatDay('')).toBe('Not set')
    expect(formatDay(null)).toBe('Not set')
  })
})

describe('initials', () => {
  it('takes the first and last name', () => {
    expect(initials('Jackie Wanjiru')).toBe('JW')
    expect(initials('Angaza team')).toBe('AT')
    expect(initials('  jackie ')).toBe('J')
  })

  it('falls back when there is no name', () => {
    expect(initials('')).toBe('?')
    expect(initials(undefined)).toBe('?')
  })
})

describe('weeklyRates', () => {
  it('groups records into Monday-starting weeks, oldest first', () => {
    const weeks = weeklyRates([
      { date: '2026-05-11', status: 'PRESENT' },
      { date: '2026-05-04', status: 'PRESENT' },
      { date: '2026-05-08', status: 'ABSENT' },
      { date: '2026-05-10', status: 'LATE' },
      { date: '2026-05-13', status: 'ABSENT' },
    ])
    expect(weeks.map((w) => w.weekStart)).toEqual(['2026-05-04', '2026-05-11'])
    expect(weeks[0]).toMatchObject({ total: 3, attended: 2 })
    expect(weeks[0].rate).toBeCloseTo(2 / 3)
    expect(weeks[1]).toMatchObject({ total: 2, attended: 1, rate: 0.5 })
  })

  it('skips records without a date and handles no records', () => {
    expect(weeklyRates([{ status: 'PRESENT' }])).toEqual([])
    expect(weeklyRates([])).toEqual([])
  })
})
