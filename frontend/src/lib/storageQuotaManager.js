/**
 * storageQuotaManager.ts
 *
 * Sprint 1 deliverable (Marlyn): local storage quota manager with 30-day
 * cleanup, sitting alongside the Dexie/IndexedDB-based offline queue
 * (db.js / syncEngine.js).
 *
 * NOTE: originally written against Amplify DataStore, per the roadmap.
 * DataStore is Gen 1-only and unavailable in this project's Gen 2 setup
 * (confirmed via AWS docs — see architecture notes). Rewritten against our
 * Dexie-based attendanceQueue, same logic: monitor usage, prune old synced
 * records, warn before hitting the browser's practical storage limits.
 */

import { db } from './db'

const QUOTA_LIMIT_BYTES = 50 * 1024 * 1024 // 50MB, per roadmap Sprint 1 target
const RETENTION_DAYS = 30
const WARN_THRESHOLD_RATIO = 0.8 // warn UI at 80% of quota, before hard cleanup



/**
 * Estimates current storage usage via the browser's Storage API.
 * Falls back gracefully on browsers/devices that don't support estimate().
 */
export async function getStorageStatus() {
  if (!('storage' in navigator) || !('estimate' in navigator.storage)) {
    return {
      usedBytes: -1,
      quotaBytes: QUOTA_LIMIT_BYTES,
      usedRatio: -1,
      approachingLimit: false,
    }
  }

  const estimate = await navigator.storage.estimate()
  const usedBytes = estimate.usage ?? 0
  const usedRatio = usedBytes / QUOTA_LIMIT_BYTES

  return {
    usedBytes,
    quotaBytes: QUOTA_LIMIT_BYTES,
    usedRatio,
    approachingLimit: usedRatio >= WARN_THRESHOLD_RATIO,
  }
}

/**
 * Approximate per-record size (JSON string byte length) — used to reason
 * about the ~3KB/record budget from the roadmap.
 */
export function estimateRecordSizeBytes(record) {
  return new TextEncoder().encode(JSON.stringify(record)).length
}

/**
 * Deletes locally-cached attendance queue records older than RETENTION_DAYS
 * that have already synced (sync_status === 'SYNCED' confirms a server
 * round-trip happened — never delete PENDING/SYNCING/FAILED records,
 * offline-queued data must survive this cleanup regardless of age).
 */
export async function pruneOldSyncedRecords() {
  const cutoff = new Date()
  cutoff.setDate(cutoff.getDate() - RETENTION_DAYS)
  const cutoffDateString = cutoff.toISOString().split('T')[0]

  const staleRecords = await db.attendanceQueue
    .where('sync_status')
    .equals('SYNCED')
    .and((r) => r.date < cutoffDateString)
    .toArray()

  for (const record of staleRecords) {
    await db.attendanceQueue.delete(record.localId)
  }

  return { deletedCount: staleRecords.length }
}

/**
 * Call this on app startup and periodically (e.g. once per sync cycle) —
 * checks quota, prunes if needed, and returns status for the sync-status UI.
 */
export async function runStorageMaintenance() {
  let status = await getStorageStatus()

  if (status.approachingLimit) {
    await pruneOldSyncedRecords()
    status = await getStorageStatus()
  }

  return status
}