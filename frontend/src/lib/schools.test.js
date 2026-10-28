import { jest } from '@jest/globals'
import { SCHOOLS, NETWORK_SCHOOL_ID, schoolName, allSchools, rememberSchools, refreshSchools } from './schools.js'
import { SMS_PREFERENCES, DEFAULT_SMS_PREFERENCE } from './smsPreference.js'

describe('schoolName', () => {
  test('names the five pilot schools', () => {
    expect(Object.keys(SCHOOLS)).toEqual(['SCH01', 'SCH02', 'SCH03', 'SCH04', 'SCH05'])
    expect(schoolName('SCH01')).toBe('Baraka Mixed Secondary School')
  })

  test('falls back to the raw id for an unknown school', () => {
    expect(schoolName('SCH99')).toBe('SCH99')
    expect(schoolName(NETWORK_SCHOOL_ID)).toBe('ANGAZA')
  })
})

describe('schools added by Angaza', () => {
  const setOnline = (value) =>
    Object.defineProperty(globalThis.navigator, 'onLine', { value, configurable: true })
  const school = { school_id: 'SCH06', name: 'Kilimani Day School', type: 'Mixed', county: 'Nairobi' }

  beforeEach(() => {
    const store = new Map()
    global.localStorage = {
      getItem: (k) => (store.has(k) ? store.get(k) : null),
      setItem: (k, v) => store.set(k, String(v)),
      removeItem: (k) => store.delete(k),
    }
    jest.spyOn(console, 'warn').mockImplementation(() => {})
  })

  afterEach(() => {
    delete global.localStorage
    jest.restoreAllMocks()
  })

  test('are kept on the device and named like the pilot schools', () => {
    rememberSchools([school])
    expect(schoolName('SCH06')).toBe('Kilimani Day School')
    expect(Object.keys(allSchools())).toEqual(expect.arrayContaining(['SCH01', 'SCH06']))
  })

  test('cannot rename a pilot school', () => {
    rememberSchools([{ school_id: 'SCH01', name: 'Something else' }])
    expect(schoolName('SCH01')).toBe('Baraka Mixed Secondary School')
  })

  test('are loaded from the server when online', async () => {
    setOnline(true)
    const graphql = jest.fn().mockResolvedValue({ data: { manageSchoolAdmins: { schools: [school] } } })
    await expect(refreshSchools(graphql)).resolves.toBe(true)
    expect(graphql.mock.calls[0][0].variables).toEqual({ input: { action: 'LIST_SCHOOLS' } })
    expect(schoolName('SCH06')).toBe('Kilimani Day School')
  })

  test('keep the saved copy when offline or when the server refuses', async () => {
    rememberSchools([school])
    setOnline(false)
    const graphql = jest.fn()
    await expect(refreshSchools(graphql)).resolves.toBe(false)
    expect(graphql).not.toHaveBeenCalled()

    setOnline(true)
    await expect(refreshSchools(jest.fn().mockRejectedValue(new Error('Only admins')))).resolves.toBe(false)
    expect(schoolName('SCH06')).toBe('Kilimani Day School')
  })

  test('still name the pilot schools when storage is blocked', () => {
    global.localStorage = {
      getItem: () => { throw new Error('blocked') },
      setItem: () => { throw new Error('blocked') },
    }
    rememberSchools([school])
    expect(schoolName('SCH01')).toBe('Baraka Mixed Secondary School')
    expect(schoolName('SCH06')).toBe('SCH06')
  })
})

describe('SMS preferences', () => {
  test('default to threshold alerts, which is one of the options', () => {
    expect(SMS_PREFERENCES.map((p) => p.value)).toContain(DEFAULT_SMS_PREFERENCE)
    expect(DEFAULT_SMS_PREFERENCE).toBe('THRESHOLD')
  })
})
