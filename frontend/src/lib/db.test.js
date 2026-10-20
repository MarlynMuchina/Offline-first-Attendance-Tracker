import { db } from './db.js'

describe('offline database', () => {
  test('is the AttendanceTrackerDB at schema version 3', () => {
    expect(db.name).toBe('AttendanceTrackerDB')
    expect(db.verno).toBe(3)
  })

  test('has the queue, roster, summary and dashboard tables', () => {
    expect(db.tables.map((t) => t.name).sort()).toEqual(
      ['aiSummaries', 'attendanceQueue', 'dashboardCache', 'students']
    )
  })

  test('indexes queued marks by sync status so pending ones can be found offline', () => {
    const indexes = db.attendanceQueue.schema.indexes.map((i) => i.name)
    expect(db.attendanceQueue.schema.primKey.name).toBe('localId')
    expect(indexes).toEqual(expect.arrayContaining(['sync_status', 'date', 'student_id']))
  })
})
