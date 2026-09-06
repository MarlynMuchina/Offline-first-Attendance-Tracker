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

// Dynamic import AFTER mocks are registered (required with unstable_mockModule)
const { syncPendingAttendance } = await import('./syncEngine.js')

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
          input: expect.objectContaining({ student_id: 'student-001', client_request_id: 'req-001' }),
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
})