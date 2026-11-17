import { studentProfile, toCsv, mergeMarks } from './studentProfile.js'

describe('studentProfile', () => {
  const records = [
    { student_id: 'S1', date: '2026-11-04', status: 'ABSENT', reason_code: 'SICK' }, // Wed
    { student_id: 'S1', date: '2026-11-02', status: 'PRESENT' }, // Mon
    { student_id: 'S1', date: '2026-11-03', status: 'ABSENT' },
    { student_id: 'S1', date: '2026-11-05', status: 'LATE' },
    { student_id: 'S1', date: '2026-11-10', status: 'PRESENT' }, // next Tue
    { student_id: 'S2', date: '2026-11-02', status: 'ABSENT' },
  ]

  it("counts only this student's days", () => {
    const p = studentProfile(records, 'S1')
    expect(p.total).toBe(5)
    expect(p.counts).toEqual({ PRESENT: 2, LATE: 1, ABSENT: 2 })
    expect(p.rate).toBe(0.6)
    expect(p.longestAbsentRun).toBe(2)
    expect(p.days[0].date).toBe('2026-11-02')
  })

  it('lays the days out as Monday-to-Friday weeks', () => {
    const p = studentProfile(records, 'S1')
    expect(p.weeks.map((w) => w.weekStart)).toEqual(['2026-11-02', '2026-11-09'])
    expect(p.weeks[0].cells.map((c) => c.record?.status ?? null)).toEqual(['PRESENT', 'ABSENT', 'ABSENT', 'LATE', null])
    expect(p.weeks[1].cells[1].record.status).toBe('PRESENT')
  })

  it('handles a student with no records', () => {
    const p = studentProfile(records, 'NOBODY')
    expect(p.total).toBe(0)
    expect(p.rate).toBeNull()
    expect(p.weeks).toEqual([])
  })
})

describe('toCsv', () => {
  it('quotes commas and quotes, and blanks missing values', () => {
    expect(toCsv(['Name', 'Rate'], [['Otieno, Brian', '85%'], ['Say "hi"', null]])).toBe(
      'Name,Rate\r\n"Otieno, Brian",85%\r\n"Say ""hi""",\r\n'
    )
  })

  it('stops cells being read as formulas', () => {
    expect(toCsv(['A'], [['=1+1']])).toBe("A\r\n'=1+1\r\n")
  })
})

describe('mergeMarks', () => {
  it("keeps one mark per day for the student, preferring the device's", () => {
    const remote = [
      { student_id: 'S1', date: '2026-11-03', status: 'PRESENT' },
      { student_id: 'S1', date: '2026-11-04', status: 'PRESENT' },
      { student_id: 'S2', date: '2026-11-04', status: 'ABSENT' },
    ]
    const local = [{ student_id: 'S1', date: '2026-11-04', status: 'ABSENT', sync_status: 'PENDING' }]
    expect(mergeMarks(remote, local, 'S1').map((r) => r.status)).toEqual(['PRESENT', 'ABSENT'])
  })
})
