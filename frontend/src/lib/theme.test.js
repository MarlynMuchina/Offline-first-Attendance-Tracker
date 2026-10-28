import { getTheme, applyTheme, setTheme } from './theme.js'

let store
const deviceDark = (dark) => {
  globalThis.matchMedia = () => ({ matches: dark })
}

beforeEach(() => {
  store = new Map()
  global.localStorage = {
    getItem: (k) => (store.has(k) ? store.get(k) : null),
    setItem: (k, v) => store.set(k, String(v)),
    removeItem: (k) => store.delete(k),
  }
  global.document = { documentElement: { dataset: {} } }
  deviceDark(false)
})

afterEach(() => {
  delete globalThis.matchMedia
})

describe('theme', () => {
  test('follows the device setting until someone picks one', () => {
    expect(getTheme()).toBe('light')
    deviceDark(true)
    expect(getTheme()).toBe('dark')
  })

  test('remembers the choice on this device and applies it to the page', () => {
    deviceDark(true)
    setTheme('light')
    expect(getTheme()).toBe('light')
    expect(document.documentElement.dataset.theme).toBe('light')
  })

  test('ignores anything stored that is not a theme', () => {
    store.set('csg.theme', 'purple')
    expect(getTheme()).toBe('light')
  })

  test('still works when storage is blocked', () => {
    global.localStorage = {
      getItem: () => { throw new Error('blocked') },
      setItem: () => { throw new Error('blocked') },
    }
    deviceDark(true)
    expect(getTheme()).toBe('dark')
    setTheme('light')
    expect(document.documentElement.dataset.theme).toBe('light')
  })

  test('applyTheme sets the page theme', () => {
    applyTheme('dark')
    expect(document.documentElement.dataset.theme).toBe('dark')
  })
})
