import { jest } from '@jest/globals'
import {
  getChronicThreshold,
  setChronicThreshold,
  getTermStart,
  setTermStart,
  getExamDate,
  setExamDate,
  defaultDateRange,
} from './settings.js'

// Node has no localStorage, so give each test a fresh in-memory one
beforeEach(() => {
  const store = new Map()
  global.localStorage = {
    getItem: (k) => (store.has(k) ? store.get(k) : null),
    setItem: (k, v) => store.set(k, String(v)),
  }
})

afterEach(() => {
  jest.useRealTimers()
  delete global.localStorage
})

describe('chronic threshold', () => {
  test('defaults to 70%', () => {
    expect(getChronicThreshold()).toBe(0.7)
  })

  test('returns a saved value', () => {
    setChronicThreshold(0.8)
    expect(getChronicThreshold()).toBe(0.8)
  })

  test.each(['abc', '0', '1.5', '-0.2'])('falls back to 70%% for an invalid value (%s)', (bad) => {
    localStorage.setItem('csg_chronic_threshold', bad)
    expect(getChronicThreshold()).toBe(0.7)
  })
})

describe('term dates', () => {
  test('are empty until saved', () => {
    expect(getTermStart()).toBe('')
    expect(getExamDate()).toBe('')
  })

  test('return what was saved', () => {
    setTermStart('2026-05-04')
    setExamDate('2026-07-10')
    expect(getTermStart()).toBe('2026-05-04')
    expect(getExamDate()).toBe('2026-07-10')
  })
})

describe('defaultDateRange', () => {
  beforeEach(() => {
    jest.useFakeTimers().setSystemTime(new Date('2026-10-20T09:00:00Z'))
  })

  test('runs from the term start to today', () => {
    setTermStart('2026-08-17')
    expect(defaultDateRange()).toEqual({ startDate: '2026-08-17', endDate: '2026-10-20' })
  })

  test('shows the last 30 days without a term start', () => {
    expect(defaultDateRange()).toEqual({ startDate: '2026-09-20', endDate: '2026-10-20' })
  })

  test('ignores a term start in the future', () => {
    setTermStart('2027-01-05')
    expect(defaultDateRange().startDate).toBe('2026-09-20')
  })
})
