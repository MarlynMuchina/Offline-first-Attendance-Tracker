import { jest } from '@jest/globals'

const mockGetClasses = jest.fn()
jest.unstable_mockModule('./auth', () => ({
  getClassesForCurrentTeacher: mockGetClasses,
}))

const saved = new Map()
const mockCache = {
  put: jest.fn(async (row) => { saved.set(row.key, row) }),
  get: jest.fn(async (key) => saved.get(key)),
}
jest.unstable_mockModule('./db', () => ({ db: { dashboardCache: mockCache } }))

const { loadTeacherClasses } = await import('./teacherClasses.js')

const jackie = { teacherName: 'Jackie Nyaboga', classes: [{ id: 'c1', name: 'Form 3 Mars' }] }

const setOnline = (value) =>
  Object.defineProperty(globalThis.navigator, 'onLine', { value, configurable: true })

beforeEach(() => {
  jest.clearAllMocks()
  saved.clear()
  setOnline(true)
})

describe('loadTeacherClasses', () => {
  test('online: returns the classes and saves them on the device', async () => {
    mockGetClasses.mockResolvedValue(jackie)
    await expect(loadTeacherClasses('u1')).resolves.toEqual({ ...jackie, savedAt: null })
    expect(saved.get('teacher:u1')).toMatchObject(jackie)
  })

  test('offline: falls back to the copy saved last time', async () => {
    mockGetClasses.mockResolvedValueOnce(jackie)
    await loadTeacherClasses('u1')

    mockGetClasses.mockRejectedValueOnce(new Error('Network error'))
    const result = await loadTeacherClasses('u1')
    expect(result).toMatchObject(jackie)
    expect(typeof result.savedAt).toBe('string')
  })

  test('offline: uses the saved copy without calling the server', async () => {
    saved.set('teacher:u1', { key: 'teacher:u1', ...jackie, saved_at: '2026-10-22T08:00:00.000Z' })
    setOnline(false)
    await expect(loadTeacherClasses('u1')).resolves.toEqual({ ...jackie, savedAt: '2026-10-22T08:00:00.000Z' })
    expect(mockGetClasses).not.toHaveBeenCalled()
  })

  test('offline with nothing saved: the error comes through', async () => {
    mockGetClasses.mockRejectedValue(new Error('Network error'))
    await expect(loadTeacherClasses('u2')).rejects.toThrow('Network error')
  })

  test('a teacher with no classes is told so, even with an old copy saved', async () => {
    saved.set('teacher:u1', { key: 'teacher:u1', ...jackie })
    mockGetClasses.mockRejectedValue(Object.assign(new Error('No classes are assigned to you yet.'), { notAssigned: true }))
    await expect(loadTeacherClasses('u1')).rejects.toThrow('No classes are assigned')
  })

  test('still returns the classes if saving them fails', async () => {
    mockGetClasses.mockResolvedValue(jackie)
    mockCache.put.mockRejectedValueOnce(new Error('quota'))
    const warn = jest.spyOn(console, 'warn').mockImplementation(() => {})
    await expect(loadTeacherClasses('u1')).resolves.toMatchObject(jackie)
    warn.mockRestore()
  })
})
