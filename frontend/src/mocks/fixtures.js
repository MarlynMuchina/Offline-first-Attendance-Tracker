// Mock data shaped to match graphql/schema/schema.graphql (once Marlyn pushes it).
// Swap these fetches for real AppSync queries in Sprint 1 — same field names, drop-in replacement.

export const mockClass = {
  class_id: 'CLS-2E',
  school_id: 'SCH-001',
  name: 'Form 2 East',
  grade: '2',
  stream: 'East'
}

export const mockStudents = [
  { student_id: 'STU-001', school_id: 'SCH-001', first_name: 'Amina', last_name: 'Otieno', class_id: 'CLS-2E', status: 'ACTIVE' },
  { student_id: 'STU-002', school_id: 'SCH-001', first_name: 'Brian', last_name: 'Kiptoo', class_id: 'CLS-2E', status: 'ACTIVE' },
  { student_id: 'STU-003', school_id: 'SCH-001', first_name: 'Cynthia', last_name: 'Wambui', class_id: 'CLS-2E', status: 'ACTIVE' },
  { student_id: 'STU-004', school_id: 'SCH-001', first_name: 'David', last_name: 'Mwangi', class_id: 'CLS-2E', status: 'ACTIVE' },
  { student_id: 'STU-005', school_id: 'SCH-001', first_name: 'Faith', last_name: 'Achieng', class_id: 'CLS-2E', status: 'ACTIVE' }
]

// Mirrors AttendanceRecord in dynamodb-design.md — includes sync_version for
// last-write-wins conflict resolution (Sprint 2), and a local-only sync_status
// field your UI needs today for the "queued vs synced" indicator (US-04).
export const mockAttendanceRecords = mockStudents.map((s) => ({
  attendance_id: `ATT-${s.student_id}`,
  school_id: 'SCH-001',
  student_id: s.student_id,
  class_id: 'CLS-2E',
  date: new Date().toISOString().slice(0, 10),
  status: 'UNMARKED', // PRESENT | ABSENT | LATE | UNMARKED
  reason_code: null,
  marked_by: null,
  marked_at: null,
  sync_version: 0,
  sync_status: 'SYNCED' // SYNCED | QUEUED | FAILED  (local-only, drives the UI indicator)
}))

export const mockAttendanceDashboard = {
  school_id: 'SCH-001',
  period: '2026-T2',
  attendance_rate: 0.87,
  chronic_absenteeism_count: 2,
  class_summaries: [
    { class_id: 'CLS-2E', attendance_rate: 0.87, absent_count: 3 },
    { class_id: 'CLS-1W', attendance_rate: 0.91, absent_count: 1 }
  ]
}
