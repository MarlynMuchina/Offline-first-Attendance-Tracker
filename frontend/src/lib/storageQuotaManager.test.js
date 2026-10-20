import { jest } from '@jest/globals'

const mockAttendanceQueue = {
  where: jest.fn(),
  delete: jest.fn(),
}

jest.unstable_mockModule('./db', () => ({
  db: { attendanceQueue: mockAttendanceQueue },
}))

const {
  getStorageStatus,
  estimateRecordSizeBytes,
  pruneOldSyncedRecords,
  runStorageMaintenance,
  getQueueHealth,
} = await import('./storageQuotaManager.js')

const MB = 1024 * 1024

function setUsage(usage) {
  Object.defineProperty(navigator, 'storage', {
    value: { estimate: jest.fn().mockResolvedValue({ usage }) },
    configurable: true,
  })
}

function daysAgo(n) {
  const d = new Date()
  d.setDate(d.getDate() - n)
  return d.toISOString().split('T')[0]
}

// where('sync_status').equals('SYNCED').and(filter).toArray() over the given records
function mockSyncedQuery(records) {
  mockAttendanceQueue.where.mockReturnValue({
    equals: jest.fn().mockReturnValue({
      and: jest.fn((filter) => ({
        toArray: jest.fn().mockResolvedValue(records.filter(filter)),
      })),
    }),
    anyOf: jest.fn().mockReturnValue({ count: jest.fn().mockResolvedValue(0) }),
  })
}

afterEach(() => {
  jest.clearAllMocks()
  delete navigator.storage
})

describe('getStorageStatus', () => {
  test('reports unknown usage when the browser has no storage estimate', async () => {
    delete navigator.storage
    const status = await getStorageStatus()
    expect(status).toEqual({ usedBytes: -1, quotaBytes: 50 * MB, usedRatio: -1, approachingLimit: false })
  })

  test('is not near the limit below 80% of 50MB', async () => {
    setUsage(10 * MB)
    const status = await getStorageStatus()
    expect(status.usedRatio).toBeCloseTo(0.2)
    expect(status.approachingLimit).toBe(false)
  })

  test('flags the limit at 80% of 50MB', async () => {
    setUsage(40 * MB)
    expect((await getStorageStatus()).approachingLimit).toBe(true)
  })

  test('treats a missing usage figure as zero', async () => {
    setUsage(undefined)
    expect((await getStorageStatus()).usedBytes).toBe(0)
  })
})

describe('estimateRecordSizeBytes', () => {
  test('measures the JSON size in bytes', () => {
    expect(estimateRecordSizeBytes({ a: 1 })).toBe(7)
  })
})

describe('pruneOldSyncedRecords', () => {
  test('deletes only synced records older than 30 days', async () => {
    mockSyncedQuery([
      { localId: 1, date: daysAgo(45) },
      { localId: 2, date: daysAgo(5) },
    ])

    const result = await pruneOldSyncedRecords()

    expect(mockAttendanceQueue.where).toHaveBeenCalledWith('sync_status')
    expect(mockAttendanceQueue.delete).toHaveBeenCalledTimes(1)
    expect(mockAttendanceQueue.delete).toHaveBeenCalledWith(1)
    expect(result).toEqual({ deletedCount: 1 })
  })
})

describe('runStorageMaintenance', () => {
  test('does not prune when there is room', async () => {
    setUsage(1 * MB)
    await runStorageMaintenance()
    expect(mockAttendanceQueue.where).not.toHaveBeenCalled()
  })

  test('prunes old synced records when near the limit', async () => {
    setUsage(45 * MB)
    mockSyncedQuery([{ localId: 9, date: daysAgo(60) }])

    await runStorageMaintenance()

    expect(mockAttendanceQueue.delete).toHaveBeenCalledWith(9)
  })
})

describe('getQueueHealth', () => {
  function mockUnsynced(count) {
    const anyOf = jest.fn().mockReturnValue({ count: jest.fn().mockResolvedValue(count) })
    mockAttendanceQueue.where.mockReturnValue({
      anyOf,
      equals: jest.fn().mockReturnValue({
        and: jest.fn().mockReturnValue({ toArray: jest.fn().mockResolvedValue([]) }),
      }),
    })
    return anyOf
  }

  test('warns when storage is nearly full and unsynced marks are waiting', async () => {
    setUsage(45 * MB)
    const anyOf = mockUnsynced(3)

    const health = await getQueueHealth()

    expect(anyOf).toHaveBeenCalledWith('PENDING', 'SYNCING', 'FAILED')
    expect(health.unsyncedCount).toBe(3)
    expect(health.criticalUnsynced).toBe(true)
  })

  test('is not critical when everything has synced', async () => {
    setUsage(45 * MB)
    mockUnsynced(0)
    expect((await getQueueHealth()).criticalUnsynced).toBe(false)
  })
})
