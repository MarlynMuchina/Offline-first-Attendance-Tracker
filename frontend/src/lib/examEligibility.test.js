import { countSchoolDaysBetween, projectEligibility } from './examEligibility.js'

describe('countSchoolDaysBetween', () => {
  test('counts weekdays strictly between the two dates', () => {
    // Fri 2026-10-09 -> Mon 2026-10-19: Mon 12 .. Fri 16 = 5 school days
    expect(countSchoolDaysBetween('2026-10-09', '2026-10-19')).toBe(5)
  })

  test('returns 0 when the exam is today or in the past', () => {
    expect(countSchoolDaysBetween('2026-10-09', '2026-10-09')).toBe(0)
    expect(countSchoolDaysBetween('2026-10-09', '2026-10-01')).toBe(0)
  })
})

describe('projectEligibility', () => {
  test('SECURED when already above threshold even if absent for the rest', () => {
    // 40/40 attended, 10 left: needs 35 of 50
    const r = projectEligibility({ attended: 40, recorded: 40, remainingDays: 10, threshold: 0.7 })
    expect(r.status).toBe('SECURED')
    expect(r.maxMoreAbsences).toBe(10)
  })

  test('ON_TRACK with the number of days that can still be missed', () => {
    // 30/40 attended, 10 left: needs 35 of 50, so 5 more, can miss 5
    const r = projectEligibility({ attended: 30, recorded: 40, remainingDays: 10, threshold: 0.7 })
    expect(r.status).toBe('ON_TRACK')
    expect(r.maxMoreAbsences).toBe(5)
  })

  test('AT_RISK when only a couple of absences are left', () => {
    // 27/40 attended, 10 left: needs 8 more, can miss 2
    const r = projectEligibility({ attended: 27, recorded: 40, remainingDays: 10, threshold: 0.7 })
    expect(r.status).toBe('AT_RISK')
    expect(r.maxMoreAbsences).toBe(2)
  })

  test('INELIGIBLE when perfect attendance can no longer reach the threshold', () => {
    // 20/40 attended, 10 left: best case 30/50 = 60%
    const r = projectEligibility({ attended: 20, recorded: 40, remainingDays: 10, threshold: 0.7 })
    expect(r.status).toBe('INELIGIBLE')
    expect(r.maxMoreAbsences).toBe(0)
  })

  test('uses the threshold passed in (2/3 rule)', () => {
    // 30 days total, 2/3 needs 20; 18/27 attended with 3 left -> needs 2 more, can miss 1
    const r = projectEligibility({ attended: 18, recorded: 27, remainingDays: 3, threshold: 2 / 3 })
    expect(r.daysNeeded).toBe(20)
    expect(r.status).toBe('AT_RISK')
    expect(r.maxMoreAbsences).toBe(1)
  })

  test('NO_DATA when nothing is recorded and nothing remains', () => {
    const r = projectEligibility({ attended: 0, recorded: 0, remainingDays: 0, threshold: 0.7 })
    expect(r.status).toBe('NO_DATA')
  })
})
