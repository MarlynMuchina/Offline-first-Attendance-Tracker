import Dexie from 'dexie'

export const db = new Dexie('AttendanceTrackerDB')

db.version(1).stores({
  students: 'id, class_id, first_name, last_name',
  attendanceQueue:
    '++localId, student_id, class_id, date, status, sync_status, marked_at, remote_id',
})