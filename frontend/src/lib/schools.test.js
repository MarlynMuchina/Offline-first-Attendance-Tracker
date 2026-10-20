import { SCHOOLS, NETWORK_SCHOOL_ID, schoolName } from './schools.js'
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

describe('SMS preferences', () => {
  test('default to threshold alerts, which is one of the options', () => {
    expect(SMS_PREFERENCES.map((p) => p.value)).toContain(DEFAULT_SMS_PREFERENCE)
    expect(DEFAULT_SMS_PREFERENCE).toBe('THRESHOLD')
  })
})
