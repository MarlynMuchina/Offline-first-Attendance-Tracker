import Dexie from 'dexie'

export const db = new Dexie('AttendanceTrackerDB')

db.version(1).stores({
  students: 'id, class_id, first_name, last_name',
  attendanceQueue:
    '++localId, student_id, class_id, date, status, sync_status, marked_at, remote_id',
})

// Latest AI summary per class, kept on the device so it can be read again
// offline or without another Bedrock call.
db.version(2).stores({
  students: 'id, class_id, first_name, last_name',
  attendanceQueue:
    '++localId, student_id, class_id, date, status, sync_status, marked_at, remote_id',
  aiSummaries: 'class_id, generated_at',
})

// Last dashboard data per class (and the admin's class list), so the admin
// dashboard still opens when the device is offline.
db.version(3).stores({
  students: 'id, class_id, first_name, last_name',
  attendanceQueue:
    '++localId, student_id, class_id, date, status, sync_status, marked_at, remote_id',
  aiSummaries: 'class_id, generated_at',
  dashboardCache: 'key',
})
