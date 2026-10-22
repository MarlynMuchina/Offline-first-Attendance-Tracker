import { jest } from '@jest/globals'
import { fromServer } from './network.js'

const setOnline = (value) =>
  Object.defineProperty(globalThis.navigator, 'onLine', { value, configurable: true })

afterEach(() => {
  jest.useRealTimers()
})

describe('fromServer', () => {
  test('returns what the server answers', async () => {
    setOnline(true)
    await expect(fromServer(async () => 'roster', 1000)).resolves.toBe('roster')
  })

  test('does not call the server while offline', async () => {
    setOnline(false)
    const request = jest.fn()
    await expect(fromServer(request, 1000)).rejects.toThrow('This device is offline')
    expect(request).not.toHaveBeenCalled()
  })

  test('gives up on a request that never finishes', async () => {
    setOnline(true)
    jest.useFakeTimers()
    const pending = fromServer(() => new Promise(() => {}), 15000)
    jest.advanceTimersByTime(15000)
    await expect(pending).rejects.toThrow('The server took too long to answer')
  })

  test('passes on a server error', async () => {
    setOnline(true)
    await expect(fromServer(async () => { throw new Error('Unauthorized') }, 1000)).rejects.toThrow('Unauthorized')
  })
})
