import { jest } from '@jest/globals'

// Mock the Dexie db module before importing syncEngine, since syncEngine
// imports `db` at module load time.
const mockAttendanceQueue = {
  where: jest.fn(),
  update: jest.fn(),
}

jest.unstable_mockModule('./db', () => ({
  db: { attendanceQueue: mockAttendanceQueue },
}))

jest.unstable_mockModule('./storageQuotaManager', () => ({
  runStorageMaintenance: jest.fn().mockResolvedValue({}),
}))

const mockGraphql = jest.fn()
jest.unstable_mockModule('aws-amplify/api', () => ({
  generateClient: () => ({ graphql: mockGraphql }),
}))

const mockGetCurrentUser = jest.fn()
jest.unstable_mockModule('aws-amplify/auth', () => ({
  getCurrentUser: mockGetCurrentUser,
}))

// syncEngine reads the school from ./auth, which needs a real Cognito session
const mockGetCurrentUserContext = jest.fn()
jest.unstable_mockModule('./auth', () => ({
  getCurrentUserContext: mockGetCurrentUserContext,
}))

// Dynamic import AFTER mocks are registered (required with unstable_mockModule)
const { syncPendingAttendance, startSyncEngine, stopSyncEngine } = await import('./syncEngine.js')
const { runStorageMaintenance } = await import('./storageQuotaManager')

function makeQueueChain(pendingRecords) {
  return {
    anyOf: jest.fn().mockReturnValue({
      toArray: jest.fn().mockResolvedValue(pendingRecords),
    }),
  }
}

describe('syncPendingAttendance', () => {
  beforeEach(() => {
    jest.clearAllMocks()
    Object.defineProperty(navigator, 'onLine', { value: true, configurable: true })
    mockGetCurrentUser.mockResolvedValue({ userId: 'teacher-001' })
    mockGetCurrentUserContext.mockResolvedValue({ schoolId: 'SCH01', userId: 'teacher-001' })
    jest.spyOn(console, 'error').mockImplementation(() => {})
  })

  test('does nothing when offline', async () => {
    Object.defineProperty(navigator, 'onLine', { value: false, configurable: true })
    mockAttendanceQueue.where.mockReturnValue(makeQueueChain([]))

    await syncPendingAttendance()

    expect(mockAttendanceQueue.where).not.toHaveBeenCalled()
  })

  test('does nothing when the queue is empty', async () => {
    mockAttendanceQueue.where.mockReturnValue(makeQueueChain([]))

    await syncPendingAttendance()

    expect(mockGraphql).not.toHaveBeenCalled()
  })

  test('sends a pending record via markAttendance and marks it SYNCED', async () => {
    const record = {
      localId: 1,
      student_id: 'student-001',
      class_id: 'class-form2east',
      date: '2026-09-05',
      status: 'PRESENT',
      marked_at: '2026-09-05T10:00:00.000Z',
      client_request_id: 'req-001',
      sync_status: 'PENDING',
    }
    mockAttendanceQueue.where.mockReturnValue(makeQueueChain([record]))
    mockGraphql.mockResolvedValue({ data: { markAttendance: { id: 'remote-id-1' } } })

    await syncPendingAttendance()

    expect(mockGraphql).toHaveBeenCalledWith(
      expect.objectContaining({
        variables: expect.objectContaining({
          input: expect.objectContaining({
            school_id: 'SCH01',
            student_id: 'student-001',
            marked_by: 'teacher-001',
            client_request_id: 'req-001',
          }),
        }),
      })
    )
    expect(mockAttendanceQueue.update).toHaveBeenCalledWith(1, { sync_status: 'SYNCING' })
    expect(mockAttendanceQueue.update).toHaveBeenCalledWith(1, {
      sync_status: 'SYNCED',
      remote_id: 'remote-id-1',
    })
  })

  test('marks a record FAILED if the mutation throws', async () => {
    const record = {
      localId: 2,
      student_id: 'student-002',
      class_id: 'class-form2east',
      date: '2026-09-05',
      status: 'ABSENT',
      marked_at: '2026-09-05T10:00:00.000Z',
      client_request_id: 'req-002',
      sync_status: 'PENDING',
    }
    mockAttendanceQueue.where.mockReturnValue(makeQueueChain([record]))
    mockGraphql.mockRejectedValue(new Error('network error'))

    await syncPendingAttendance()

    expect(mockAttendanceQueue.update).toHaveBeenCalledWith(2, { sync_status: 'FAILED' })
  })

  test('skips syncing if the user session cannot be resolved', async () => {
    mockGetCurrentUser.mockRejectedValue(new Error('not signed in'))
    mockAttendanceQueue.where.mockReturnValue(makeQueueChain([{ localId: 3 }]))

    await syncPendingAttendance()

    expect(mockGraphql).not.toHaveBeenCalled()
  })

  test('skips syncing if the school cannot be read from the session', async () => {
    mockGetCurrentUserContext.mockRejectedValue(new Error('school_id not set on this user account'))
    mockAttendanceQueue.where.mockReturnValue(makeQueueChain([{ localId: 4 }]))

    await syncPendingAttendance()

    expect(mockGraphql).not.toHaveBeenCalled()
    expect(mockAttendanceQueue.update).not.toHaveBeenCalled()
  })

  test('retries FAILED records along with PENDING ones', async () => {
    const chain = makeQueueChain([])
    mockAttendanceQueue.where.mockReturnValue(chain)

    await syncPendingAttendance()

    expect(mockAttendanceQueue.where).toHaveBeenCalledWith('sync_status')
    expect(chain.anyOf).toHaveBeenCalledWith('PENDING', 'FAILED')
  })

  test('keeps going after one record fails', async () => {
    const base = { class_id: 'c1', date: '2026-09-05', status: 'PRESENT', marked_at: 'x', sync_status: 'PENDING' }
    mockAttendanceQueue.where.mockReturnValue(
      makeQueueChain([
        { ...base, localId: 5, student_id: 's5', client_request_id: 'r5' },
        { ...base, localId: 6, student_id: 's6', client_request_id: 'r6' },
      ])
    )
    mockGraphql
      .mockRejectedValueOnce(new Error('network error'))
      .mockResolvedValueOnce({ data: { markAttendance: { id: 'remote-6' } } })

    await syncPendingAttendance()

    expect(mockAttendanceQueue.update).toHaveBeenCalledWith(5, { sync_status: 'FAILED' })
    expect(mockAttendanceQueue.update).toHaveBeenCalledWith(6, { sync_status: 'SYNCED', remote_id: 'remote-6' })
  })

  test('sends up to 4 records at once and syncs every one of them', async () => {
    const records = Array.from({ length: 10 }, (_, i) => ({
      localId: 100 + i,
      student_id: `s${i}`,
      class_id: 'c1',
      date: '2026-09-05',
      status: 'PRESENT',
      marked_at: 'x',
      client_request_id: `r${i}`,
      sync_status: 'PENDING',
    }))
    mockAttendanceQueue.where.mockReturnValue(makeQueueChain(records))
    let inFlight = 0
    let maxInFlight = 0
    mockGraphql.mockImplementation(async ({ variables }) => {
      inFlight++
      maxInFlight = Math.max(maxInFlight, inFlight)
      await new Promise((resolve) => setTimeout(resolve, 5))
      inFlight--
      return { data: { markAttendance: { id: `remote-${variables.input.student_id}` } } }
    })

    await syncPendingAttendance()

    expect(mockGraphql).toHaveBeenCalledTimes(10)
    expect(maxInFlight).toBe(4)
    for (const r of records) {
      expect(mockAttendanceQueue.update).toHaveBeenCalledWith(r.localId, {
        sync_status: 'SYNCED',
        remote_id: `remote-${r.student_id}`,
      })
    }
  })

  test('runs storage maintenance after every online sync attempt', async () => {
    mockAttendanceQueue.where.mockReturnValue(makeQueueChain([]))

    await syncPendingAttendance()

    expect(runStorageMaintenance).toHaveBeenCalledTimes(1)
  })

  test('ignores a second call while a sync is already running', async () => {
    let release
    const gate = new Promise((resolve) => { release = resolve })
    mockAttendanceQueue.where.mockReturnValue({
      anyOf: jest.fn().mockReturnValue({ toArray: jest.fn().mockReturnValue(gate.then(() => [])) }),
    })

    const first = syncPendingAttendance()
    await syncPendingAttendance()
    release()
    await first

    expect(mockAttendanceQueue.where).toHaveBeenCalledTimes(1)
  })
})

describe('startSyncEngine / stopSyncEngine', () => {
  beforeEach(() => {
    jest.clearAllMocks()
    global.window = { addEventListener: jest.fn(), removeEventListener: jest.fn() }
    Object.defineProperty(navigator, 'onLine', { value: false, configurable: true })
  })

  afterEach(() => {
    delete global.window
  })

  test('syncs when the device comes back online', () => {
    startSyncEngine()
    expect(window.addEventListener).toHaveBeenCalledWith('online', syncPendingAttendance)
  })

  test('stops listening for the online event', () => {
    stopSyncEngine()
    expect(window.removeEventListener).toHaveBeenCalledWith('online', syncPendingAttendance)
  })
})
