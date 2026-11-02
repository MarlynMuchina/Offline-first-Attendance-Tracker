import { jest } from '@jest/globals'
import { startIdleWatch, markActive, forgetActivity, idleTooLong } from './idleSignOut.js'

const LIMIT = 15 * 60 * 1000

function fakeWindow() {
  const listeners = new Map()
  return {
    addEventListener: (name, fn) => listeners.set(name, fn),
    removeEventListener: (name) => listeners.delete(name),
    fire: (name) => listeners.get(name)?.(),
    has: (name) => listeners.has(name),
  }
}

let store
let clock
let online
let target
let onIdle
let stop

function start() {
  stop = startIdleWatch({ onIdle, limitMs: LIMIT, isOnline: () => online, now: () => clock, target })
}

beforeEach(() => {
  jest.useFakeTimers()
  store = new Map()
  global.localStorage = {
    getItem: (k) => (store.has(k) ? store.get(k) : null),
    setItem: (k, v) => store.set(k, String(v)),
    removeItem: (k) => store.delete(k),
  }
  clock = 100_000_000
  online = true
  target = fakeWindow()
  onIdle = jest.fn()
  stop = () => {}
})

afterEach(() => {
  stop()
  jest.useRealTimers()
})

function wait(ms) {
  clock += ms
  jest.advanceTimersByTime(ms)
}

describe('startIdleWatch', () => {
  test('signs out after 15 minutes with no activity', () => {
    start()
    wait(LIMIT - 60 * 1000)
    expect(onIdle).not.toHaveBeenCalled()
    wait(60 * 1000)
    expect(onIdle).toHaveBeenCalledTimes(1)
  })

  test('a tap or key press starts the 15 minutes again', () => {
    start()
    wait(10 * 60 * 1000)
    target.fire('pointerdown')
    wait(10 * 60 * 1000)
    expect(onIdle).not.toHaveBeenCalled()
    target.fire('keydown')
    wait(LIMIT)
    expect(onIdle).toHaveBeenCalledTimes(1)
  })

  test('reopening or reloading the app after 15 minutes signs out straight away', () => {
    start()
    stop()
    clock += LIMIT + 1
    start()
    expect(onIdle).toHaveBeenCalledTimes(1)
  })

  test('never signs out offline, and does once the connection is back', () => {
    online = false
    start()
    wait(LIMIT * 4)
    expect(onIdle).not.toHaveBeenCalled()
    online = true
    target.fire('online')
    expect(onIdle).toHaveBeenCalledTimes(1)
  })

  test('checks straight away when the app comes back into view', () => {
    start()
    clock += LIMIT
    target.fire('visibilitychange')
    expect(onIdle).toHaveBeenCalledTimes(1)
  })

  test('signs out only once', () => {
    start()
    wait(LIMIT * 3)
    target.fire('focus')
    expect(onIdle).toHaveBeenCalledTimes(1)
  })

  test('stop removes the listeners and the timer', () => {
    start()
    stop()
    expect(target.has('pointerdown')).toBe(false)
    expect(target.has('online')).toBe(false)
    wait(LIMIT * 2)
    expect(onIdle).not.toHaveBeenCalled()
  })
})

describe('idleTooLong', () => {
  test('a fresh sign-in counts as activity', () => {
    markActive(clock - LIMIT * 10)
    expect(idleTooLong({ now: clock, limitMs: LIMIT })).toBe(true)
    markActive(clock)
    expect(idleTooLong({ now: clock, limitMs: LIMIT })).toBe(false)
  })

  test('no saved time, as after signing out, is not idle', () => {
    markActive(clock - LIMIT * 10)
    forgetActivity()
    expect(idleTooLong({ now: clock, limitMs: LIMIT })).toBe(false)
  })
})
