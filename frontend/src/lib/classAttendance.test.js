import { jest } from '@jest/globals'
import { fetchClassAttendance, resetForTests } from './classAttendance.js'

const range = { classId: 'C1', startDate: '2026-05-04', endDate: '2026-07-10' }
const record = (id) => ({ id, student_id: 'S1', date: '2026-05-04', status: 'PRESENT' })
const missingField = {
  errors: [{ message: "Validation error of type FieldUndefined: Field 'attendanceRecordsByClass_idAndDate' in type 'Query' is undefined" }],
}

beforeEach(() => {
  resetForTests()
  jest.spyOn(console, 'warn').mockImplementation(() => {})
})

afterEach(() => {
  jest.restoreAllMocks()
})

describe('fetchClassAttendance', () => {
  test('reads the class and dates through the index, page by page', async () => {
    const graphql = jest
      .fn()
      .mockResolvedValueOnce({ data: { attendanceRecordsByClass_idAndDate: { items: [record('a')], nextToken: 't1' } } })
      .mockResolvedValueOnce({ data: { attendanceRecordsByClass_idAndDate: { items: [record('b')], nextToken: null } } })

    const records = await fetchClassAttendance(graphql, range)

    expect(records.map((r) => r.id)).toEqual(['a', 'b'])
    expect(graphql).toHaveBeenCalledTimes(2)
    expect(graphql.mock.calls[0][0].query).toContain('attendanceRecordsByClass_idAndDate')
    expect(graphql.mock.calls[0][0].variables).toEqual({ ...range, nextToken: null })
    expect(graphql.mock.calls[1][0].variables.nextToken).toBe('t1')
  })

  test('falls back to the full list when the API has no index query, and remembers it', async () => {
    const graphql = jest.fn(async ({ query }) => {
      if (query.includes('attendanceRecordsByClass_idAndDate')) throw missingField
      return { data: { listAttendanceRecords: { items: [record('a')], nextToken: null } } }
    })

    expect(await fetchClassAttendance(graphql, range)).toEqual([record('a')])
    expect(await fetchClassAttendance(graphql, range)).toEqual([record('a')])

    const indexCalls = graphql.mock.calls.filter(([arg]) => arg.query.includes('attendanceRecordsByClass_idAndDate'))
    expect(indexCalls).toHaveLength(1)
  })

  test('passes other errors on instead of hiding them', async () => {
    const graphql = jest.fn().mockRejectedValue(new Error('Network error'))
    await expect(fetchClassAttendance(graphql, range)).rejects.toThrow('Network error')
    expect(graphql).toHaveBeenCalledTimes(1)
  })
})
