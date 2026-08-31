import { generateClient } from 'aws-amplify/api'
import { getCurrentUser } from 'aws-amplify/auth'
import { db } from './db'
import { runStorageMaintenance } from './storageQuotaManager'

const client = generateClient()

const createAttendanceRecord = /* GraphQL */ `
  mutation CreateAttendanceRecord($input: CreateAttendanceRecordInput!) {
    createAttendanceRecord(input: $input) {
      id
      student_id
      status
      marked_at
    }
  }
`

const updateAttendanceRecord = /* GraphQL */ `
  mutation UpdateAttendanceRecord($input: UpdateAttendanceRecordInput!) {
    updateAttendanceRecord(input: $input) {
      id
      student_id
      status
      marked_at
    }
  }
`

const SCHOOL_ID = 'school-001' // TODO: replace with real school context once Admin module exists

let syncInProgress = false

export async function syncPendingAttendance() {
  if (syncInProgress) return
  if (!navigator.onLine) return

  syncInProgress = true
  try {
    const pending = await db.attendanceQueue
      .where('sync_status')
      .anyOf('PENDING', 'FAILED')
      .toArray()

    if (pending.length === 0) return

    let user
    try {
      user = await getCurrentUser()
    } catch {
      return
    }

    for (const record of pending) {
      await db.attendanceQueue.update(record.localId, { sync_status: 'SYNCING' })

      try {
        let result
        if (record.remote_id) {
          result = await client.graphql({
            query: updateAttendanceRecord,
            variables: {
              input: {
                id: record.remote_id,
                status: record.status,
                marked_at: record.marked_at,
              },
            },
          })
          await db.attendanceQueue.update(record.localId, {
            sync_status: 'SYNCED',
            remote_id: result.data.updateAttendanceRecord.id,
          })
        } else {
          result = await client.graphql({
            query: createAttendanceRecord,
            variables: {
              input: {
                school_id: SCHOOL_ID,
                student_id: record.student_id,
                class_id: record.class_id,
                date: record.date,
                status: record.status,
                marked_by: user.userId,
                marked_at: record.marked_at,
              },
            },
          })
          await db.attendanceQueue.update(record.localId, {
            sync_status: 'SYNCED',
            remote_id: result.data.createAttendanceRecord.id,
          })
        }
      } catch (err) {
        console.error('Sync failed for record', record.localId, err)
        await db.attendanceQueue.update(record.localId, { sync_status: 'FAILED' })
      }
    }
  } finally {
    await runStorageMaintenance()
    syncInProgress = false
  }
}

export function startSyncEngine() {
  window.addEventListener('online', syncPendingAttendance)
  syncPendingAttendance()
}