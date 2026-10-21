
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

const SYNC_CONCURRENCY = 4

let syncInProgress = false

async function syncRecord(record, schoolId, userId) {
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
          marked_by: userId,
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

    // A few records at a time, so a class marked offline catches up quickly
    // without flooding the markAttendance Lambda when the connection returns.
    const queue = [...pending]
    const worker = async () => {
      while (queue.length) {
        await syncRecord(queue.shift(), schoolId, user.userId)
      }
    }
    await Promise.all(Array.from({ length: Math.min(SYNC_CONCURRENCY, queue.length) }, worker))
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