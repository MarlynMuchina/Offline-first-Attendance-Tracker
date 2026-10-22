import { rememberSession, readRememberedSession, forgetSession } from './offlineSession.js'

// Node has no localStorage, so give each test a fresh in-memory one
beforeEach(() => {
  const store = new Map()
  global.localStorage = {
    getItem: (k) => (store.has(k) ? store.get(k) : null),
    setItem: (k, v) => store.set(k, String(v)),
    removeItem: (k) => store.delete(k),
  }
})

describe('offline session', () => {
  test('keeps the last sign-in with the time it was saved', () => {
    rememberSession({ userId: 'u1', groups: ['Teacher'], schoolId: 'SCH01' })
    const saved = readRememberedSession()
    expect(saved).toMatchObject({ userId: 'u1', groups: ['Teacher'], schoolId: 'SCH01' })
    expect(typeof saved.saved_at).toBe('string')
  })

  test('has nothing before a sign-in and after a sign-out', () => {
    expect(readRememberedSession()).toBeNull()
    rememberSession({ userId: 'u1' })
    forgetSession()
    expect(readRememberedSession()).toBeNull()
  })

  test('copes when the browser blocks storage', () => {
    global.localStorage = {
      getItem: () => { throw new Error('blocked') },
      setItem: () => { throw new Error('blocked') },
      removeItem: () => { throw new Error('blocked') },
    }
    expect(() => rememberSession({ userId: 'u1' })).not.toThrow()
    expect(readRememberedSession()).toBeNull()
    expect(() => forgetSession()).not.toThrow()
  })
})
