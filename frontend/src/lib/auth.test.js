import { jest } from '@jest/globals'

const mockFetchAuthSession = jest.fn()
jest.unstable_mockModule('aws-amplify/auth', () => ({
  fetchAuthSession: mockFetchAuthSession,
}))

const mockGraphql = jest.fn()
jest.unstable_mockModule('aws-amplify/api', () => ({
  generateClient: () => ({ graphql: mockGraphql }),
}))

const { getSignedInSession, getCurrentUserContext, getClassesForSchool, getClassesForCurrentTeacher } =
  await import('./auth.js')

// One page of a list query, as AppSync returns it
const page = (field, items, nextToken = null) => ({ data: { [field]: { items, nextToken } } })

const setOnline = (value) =>
  Object.defineProperty(globalThis.navigator, 'onLine', { value, configurable: true })

afterEach(() => {
  jest.useRealTimers()
})

beforeEach(() => {
  jest.clearAllMocks()
  setOnline(true)
  // Node has no localStorage, so give each test a fresh in-memory one
  const store = new Map()
  global.localStorage = {
    getItem: (k) => (store.has(k) ? store.get(k) : null),
    setItem: (k, v) => store.set(k, String(v)),
    removeItem: (k) => store.delete(k),
  }
})

const teacherTokens = {
  tokens: {
    idToken: {
      payload: { 'cognito:groups': ['Teacher'], 'custom:school_id': 'SCH01', sub: 'u1', phone_number: '+254700000001' },
    },
  },
}

describe('getSignedInSession', () => {
  test('reads the groups and school, and saves them for offline use', async () => {
    mockFetchAuthSession.mockResolvedValue(teacherTokens)
    await expect(getSignedInSession({ forceRefresh: true })).resolves.toEqual({
      groups: ['Teacher'],
      schoolId: 'SCH01',
      userId: 'u1',
      phoneNumber: '+254700000001',
      savedCopy: false,
    })
    expect(mockFetchAuthSession).toHaveBeenCalledWith({ forceRefresh: true })
  })

  test('uses the saved sign-in when the tokens cannot be refreshed offline', async () => {
    mockFetchAuthSession.mockResolvedValueOnce(teacherTokens)
    await getSignedInSession()

    mockFetchAuthSession.mockRejectedValueOnce(new Error('Network error'))
    await expect(getSignedInSession()).resolves.toMatchObject({
      groups: ['Teacher'],
      schoolId: 'SCH01',
      userId: 'u1',
      savedCopy: true,
    })
  })

  test('offline: uses the saved sign-in without asking Amplify', async () => {
    mockFetchAuthSession.mockResolvedValueOnce(teacherTokens)
    await getSignedInSession()

    setOnline(false)
    await expect(getSignedInSession()).resolves.toMatchObject({ userId: 'u1', savedCopy: true })
    expect(mockFetchAuthSession).toHaveBeenCalledTimes(1)
  })

  test('uses the saved sign-in when a refresh hangs on a connection with no internet', async () => {
    mockFetchAuthSession.mockResolvedValueOnce(teacherTokens)
    await getSignedInSession()

    jest.useFakeTimers()
    mockFetchAuthSession.mockReturnValueOnce(new Promise(() => {}))
    const pending = getSignedInSession()
    await jest.advanceTimersByTimeAsync(10000)
    await expect(pending).resolves.toMatchObject({ userId: 'u1', savedCopy: true })
  })

  test('offline with no saved sign-in: the error comes through', async () => {
    mockFetchAuthSession.mockRejectedValue(new Error('Network error'))
    await expect(getSignedInSession()).rejects.toThrow('Network error')
  })

  test('a signed-out device is not let in, even with a saved sign-in', async () => {
    mockFetchAuthSession.mockResolvedValueOnce(teacherTokens)
    await getSignedInSession()
    mockFetchAuthSession.mockResolvedValueOnce({ tokens: undefined })
    await expect(getSignedInSession()).rejects.toThrow('No active session')
  })

  test('accounts with no groups get an empty list', async () => {
    mockFetchAuthSession.mockResolvedValue({ tokens: { idToken: { payload: { sub: 'u2' } } } })
    await expect(getSignedInSession()).resolves.toMatchObject({ groups: [], userId: 'u2' })
  })
})

describe('getCurrentUserContext', () => {
  test('reads the school, user and phone from the ID token', async () => {
    mockFetchAuthSession.mockResolvedValue({
      tokens: { idToken: { payload: { 'custom:school_id': 'SCH01', sub: 'u1', phone_number: '+254700000001' } } },
    })
    await expect(getCurrentUserContext()).resolves.toEqual({
      schoolId: 'SCH01',
      userId: 'u1',
      phoneNumber: '+254700000001',
    })
  })

  test('fails without a session', async () => {
    mockFetchAuthSession.mockResolvedValue({})
    await expect(getCurrentUserContext()).rejects.toThrow('No active session')
  })

  test('fails when the account has no school', async () => {
    mockFetchAuthSession.mockResolvedValue({ tokens: { idToken: { payload: { sub: 'u1' } } } })
    await expect(getCurrentUserContext()).rejects.toThrow('school_id not set')
  })
})

describe('getClassesForSchool', () => {
  test('follows every page and sorts the classes by name', async () => {
    mockGraphql
      .mockResolvedValueOnce(page('listClasses', [{ id: 'c2', name: 'Form 3 Mars' }, null], 'next'))
      .mockResolvedValueOnce(page('listClasses', [{ id: 'c1', name: 'Form 2 North' }]))

    const classes = await getClassesForSchool('SCH01')

    expect(mockGraphql).toHaveBeenCalledTimes(2)
    expect(mockGraphql.mock.calls[1][0].variables).toEqual({ schoolId: 'SCH01', nextToken: 'next' })
    expect(classes.map((c) => c.name)).toEqual(['Form 2 North', 'Form 3 Mars'])
  })

  test('fails when the school has no classes', async () => {
    mockGraphql.mockResolvedValueOnce(page('listClasses', []))
    await expect(getClassesForSchool('SCH09')).rejects.toThrow('No class found for school SCH09')
  })
})

describe('getClassesForCurrentTeacher', () => {
  test('finds the teacher on a later page, then lists their classes', async () => {
    mockGraphql
      .mockResolvedValueOnce(page('listTeachers', [], 'more'))
      .mockResolvedValueOnce(page('listTeachers', [{ id: 't1', first_name: 'Kenny', last_name: 'Miriti' }], 'unused'))
      .mockResolvedValueOnce(page('listClasses', [{ id: 'c1', name: 'Form 2 North' }]))

    const result = await getClassesForCurrentTeacher('sub-1')

    // stops paging teachers as soon as one is found
    expect(mockGraphql).toHaveBeenCalledTimes(3)
    expect(mockGraphql.mock.calls[2][0].variables).toEqual({ teacherId: 't1', nextToken: null })
    expect(result).toEqual({ teacherName: 'Kenny Miriti', classes: [{ id: 'c1', name: 'Form 2 North' }] })
  })

  test('fails when no teacher record is linked to the login', async () => {
    mockGraphql.mockResolvedValueOnce(page('listTeachers', []))
    await expect(getClassesForCurrentTeacher('sub-x')).rejects.toMatchObject({ notAssigned: true, message: expect.stringContaining('No teacher record is linked') })
  })

  test('fails when the teacher has no classes', async () => {
    mockGraphql
      .mockResolvedValueOnce(page('listTeachers', [{ id: 't2', first_name: 'A', last_name: 'B' }]))
      .mockResolvedValueOnce(page('listClasses', []))
    await expect(getClassesForCurrentTeacher('sub-2')).rejects.toMatchObject({ notAssigned: true, message: 'No classes are assigned to you yet.' })
  })
})
