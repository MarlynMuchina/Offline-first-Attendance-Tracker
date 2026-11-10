import { REASONS, reasonsFor, cleanReason, reasonLabel, summarizeReasons, absencesToFollowUp, NOT_GIVEN } from './reasons.js'

describe('reasonsFor', () => {
  it('lists reasons for absent and late only', () => {
    expect(reasonsFor('ABSENT')).toBe(REASONS.ABSENT)
    expect(reasonsFor('LATE')).toBe(REASONS.LATE)
    expect(reasonsFor('PRESENT')).toEqual([])
  })
})

describe('cleanReason', () => {
  it('keeps a reason that fits the status', () => {
    expect(cleanReason('ABSENT', 'SICK')).toBe('SICK')
    expect(cleanReason('LATE', 'CHORES')).toBe('CHORES')
  })

  it('drops a reason that does not fit', () => {
    expect(cleanReason('LATE', 'SICK')).toBeNull()
    expect(cleanReason('PRESENT', 'SICK')).toBeNull()
    expect(cleanReason('ABSENT', 'MADE_UP')).toBeNull()
    expect(cleanReason('ABSENT', null)).toBeNull()
  })
})

describe('reasonLabel', () => {
  it('names known reasons', () => {
    expect(reasonLabel('ABSENT', 'FEES')).toBe('School fees')
  })

  it('treats imported and missing codes as not given', () => {
    expect(reasonLabel('ABSENT', 'UNEXCUSED')).toBe('Not given')
    expect(reasonLabel('LATE', 'LATE_ARRIVING')).toBe('Not given')
    expect(reasonLabel('ABSENT', null)).toBe('Not given')
    expect(reasonLabel('ABSENT', 'MADE_UP')).toBe('Not given')
  })
})

describe('summarizeReasons', () => {
  const records = [
    { status: 'ABSENT', reason_code: 'SICK' },
    { status: 'ABSENT', reason_code: 'SICK' },
    { status: 'ABSENT', reason_code: 'FEES' },
    { status: 'ABSENT', reason_code: 'UNEXCUSED' },
    { status: 'LATE', reason_code: 'TRANSPORT' },
    { status: 'LATE', reason_code: null },
    { status: 'PRESENT', reason_code: null },
  ]

  it('counts reasons per status, biggest first', () => {
    const { ABSENT, LATE } = summarizeReasons(records)
    expect(ABSENT.total).toBe(4)
    expect(ABSENT.given).toBe(3)
    expect(ABSENT.rows[0]).toEqual({ code: 'SICK', label: 'Sick', count: 2, share: 0.5 })
    expect(ABSENT.rows.find((r) => r.code === NOT_GIVEN).count).toBe(1)
    expect(LATE.total).toBe(2)
    expect(LATE.given).toBe(1)
  })

  it('keeps every reason row, even at zero', () => {
    const { ABSENT, LATE } = summarizeReasons(records)
    expect(ABSENT.rows).toHaveLength(REASONS.ABSENT.length + 1)
    expect(LATE.rows).toHaveLength(REASONS.LATE.length + 1)
    expect(ABSENT.rows.find((r) => r.code === 'WEATHER').count).toBe(0)
  })

  it('handles no records', () => {
    const { ABSENT } = summarizeReasons([])
    expect(ABSENT.total).toBe(0)
    expect(ABSENT.rows.every((r) => r.share === 0)).toBe(true)
  })
})

describe('summarizeReasons labels', () => {
  it('calls a missing absence reason not known yet', () => {
    const { ABSENT, LATE } = summarizeReasons([{ status: 'ABSENT' }, { status: 'LATE' }])
    expect(ABSENT.rows.find((r) => r.code === NOT_GIVEN).label).toBe('Not known yet')
    expect(LATE.rows.find((r) => r.code === NOT_GIVEN).label).toBe('Not given')
  })
})

describe('absencesToFollowUp', () => {
  const students = [
    { id: 'S1', first_name: 'Faith', last_name: 'Achieng' },
    { id: 'S2', first_name: 'Brian', last_name: 'Otieno' },
  ]

  it('lists recent absences with no reason, newest first', () => {
    const list = absencesToFollowUp({
      students,
      since: '2026-11-01',
      remote: [
        { id: 'r1', student_id: 'S1', date: '2026-11-03', status: 'ABSENT', reason_code: 'UNEXCUSED' },
        { id: 'r2', student_id: 'S2', date: '2026-11-05', status: 'ABSENT', reason_code: null },
        { id: 'r3', student_id: 'S2', date: '2026-11-04', status: 'ABSENT', reason_code: 'SICK' },
        { id: 'r4', student_id: 'S1', date: '2026-10-20', status: 'ABSENT', reason_code: null },
        { id: 'r5', student_id: 'S1', date: '2026-11-06', status: 'LATE', reason_code: null },
      ],
    })
    expect(list.map((r) => r.id)).toEqual(['r2', 'r1'])
    expect(list[0].name).toBe('Brian Otieno')
  })

  it("prefers the device's copy of the same day", () => {
    const list = absencesToFollowUp({
      students,
      since: '2026-11-01',
      remote: [{ id: 'r1', student_id: 'S1', date: '2026-11-03', status: 'ABSENT', reason_code: null }],
      local: [{ localId: 7, student_id: 'S1', date: '2026-11-03', status: 'ABSENT', reason_code: 'FEES' }],
    })
    expect(list).toEqual([])
  })

  it('leaves out students no longer in the class', () => {
    const list = absencesToFollowUp({
      students,
      since: '2026-11-01',
      remote: [{ id: 'r9', student_id: 'GONE', date: '2026-11-03', status: 'ABSENT' }],
    })
    expect(list).toEqual([])
  })
})
