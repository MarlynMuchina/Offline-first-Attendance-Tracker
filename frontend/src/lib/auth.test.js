import { jest } from '@jest/globals'

const mockFetchAuthSession = jest.fn()
jest.unstable_mockModule('aws-amplify/auth', () => ({
  fetchAuthSession: mockFetchAuthSession,
}))

const mockGraphql = jest.fn()
jest.unstable_mockModule('aws-amplify/api', () => ({
  generateClient: () => ({ graphql: mockGraphql }),
}))

const { getCurrentUserContext, getClassesForSchool, getClassesForCurrentTeacher } = await import('./auth.js')

// One page of a list query, as AppSync returns it
const page = (field, items, nextToken = null) => ({ data: { [field]: { items, nextToken } } })

beforeEach(() => {
  jest.clearAllMocks()
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
    await expect(getClassesForCurrentTeacher('sub-x')).rejects.toThrow('No teacher record is linked')
  })

  test('fails when the teacher has no classes', async () => {
    mockGraphql
      .mockResolvedValueOnce(page('listTeachers', [{ id: 't2', first_name: 'A', last_name: 'B' }]))
      .mockResolvedValueOnce(page('listClasses', []))
    await expect(getClassesForCurrentTeacher('sub-2')).rejects.toThrow('No classes are assigned to you yet.')
  })
})
