import { generateClient } from 'aws-amplify/api'
import { getCurrentUser } from 'aws-amplify/auth'
import { db } from './db'
import { runStorageMaintenance } from './storageQuotaManager'
import { getCurrentUserContext } from './auth'

const client = generateClient()

const markAttendance = /* GraphQL */ `
  mutation MarkAttendance($input: MarkAttendanceInput!) {
    markAttendance(input: $input) {
      id
      student_id
      status
      marked_at
    }
  }
`

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
    let schoolId
    try {
      user = await getCurrentUser()
      const ctx = await getCurrentUserContext()
      schoolId = ctx.schoolId
    } catch {
      return
    }

    for (const record of pending) {
      await db.attendanceQueue.update(record.localId, { sync_status: 'SYNCING' })
      try {
        const result = await client.graphql({
          query: markAttendance,
          variables: {
            input: {
              school_id: schoolId,
              student_id: record.student_id,
              class_id: record.class_id,
              date: record.date,
              status: record.status,
              marked_by: user.userId,
              marked_at: record.marked_at,
              client_request_id: record.client_request_id,
            },
          },
        })
        await db.attendanceQueue.update(record.localId, {
          sync_status: 'SYNCED',
          remote_id: result.data.markAttendance.id,
        })
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

export function stopSyncEngine() {
  window.removeEventListener('online', syncPendingAttendance)
}