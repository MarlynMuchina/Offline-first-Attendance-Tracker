// Bulk-data load test: what happens when a lot of attendance arrives at once.
//
// 1. A whole term marked offline (every school in the dataset, 5 x 36
//    students x 48 days = 8,640 marks) is queued on one device and synced
//    when the connection returns, over a simulated network that is slow and
//    drops 3% of requests.
// 2. The dashboard figures are worked out from 100,000 records.
//
// It takes about 35 seconds, so plain `npm test` skips it. Run it with:
//   npm run test:load
// The timings are printed as a table for Chapter 5.
import { jest } from '@jest/globals'

// An in-memory stand-in for the Dexie attendance queue.
const rows = new Map()
const fakeQueue = {
  where: () => ({
    anyOf: (...statuses) => ({
      toArray: async () => [...rows.values()].filter((r) => statuses.includes(r.sync_status)).map((r) => ({ ...r })),
    }),
  }),
  update: async (localId, changes) => {
    Object.assign(rows.get(localId), changes)
  },
}

jest.unstable_mockModule('./db', () => ({ db: { attendanceQueue: fakeQueue } }))
jest.unstable_mockModule('./storageQuotaManager', () => ({ runStorageMaintenance: async () => ({}) }))
jest.unstable_mockModule('aws-amplify/auth', () => ({ getCurrentUser: async () => ({ userId: 'teacher-1' }) }))
jest.unstable_mockModule('./auth', () => ({ getCurrentUserContext: async () => ({ schoolId: 'SCH01' }) }))

// The simulated server: 5 to 25 ms per request, 3% of requests fail, and it
// remembers every client_request_id it accepted (like markAttendance does).
let inFlight = 0
let peakInFlight = 0
const accepted = new Map()
let requests = 0
let seed = 42
const random = () => {
  seed = (seed * 1103515245 + 12345) % 2147483648
  return seed / 2147483648
}
const graphql = async ({ variables: { input } }) => {
  requests += 1
  inFlight += 1
  peakInFlight = Math.max(peakInFlight, inFlight)
  try {
    await new Promise((resolve) => setTimeout(resolve, 5 + random() * 20))
    if (random() < 0.03) throw new Error('Network request failed')
    accepted.set(input.client_request_id, (accepted.get(input.client_request_id) || 0) + 1)
    return { data: { markAttendance: { id: `remote-${input.client_request_id}` } } }
  } finally {
    inFlight -= 1
  }
}
jest.unstable_mockModule('aws-amplify/api', () => ({ generateClient: () => ({ graphql }) }))

const { syncPendingAttendance } = await import('./syncEngine.js')
const { weeklyRates, weekdayRates, statusSplit } = await import('./display.js')
const { summarizeReasons } = await import('./reasons.js')

const SCHOOLS = 5
const STUDENTS_PER_CLASS = 36
const TERM_DAYS = 48

// School days from 4 May 2026, Monday to Friday.
function schoolDays(count) {
  const days = []
  const d = new Date('2026-05-04T00:00:00Z')
  while (days.length < count) {
    const wd = d.getUTCDay()
    if (wd !== 0 && wd !== 6) days.push(d.toISOString().slice(0, 10))
    d.setUTCDate(d.getUTCDate() + 1)
  }
  return days
}

function makeMarks(schools, students, days) {
  const dates = schoolDays(days)
  const marks = []
  for (let s = 1; s <= schools; s++) {
    for (let st = 1; st <= students; st++) {
      for (const date of dates) {
        const roll = random()
        marks.push({
          student_id: `SCH0${s}-S${String(st).padStart(3, '0')}`,
          class_id: `SCH0${s}-CLASS`,
          date,
          status: roll < 0.08 ? 'ABSENT' : roll < 0.12 ? 'LATE' : 'PRESENT',
          reason_code: roll < 0.03 ? 'SICK' : undefined,
        })
      }
    }
  }
  return marks
}

const results = []

afterAll(() => {
  // A table to copy into Chapter 5.
  console.log(['', '| Test | Data | Result |', '| --- | --- | --- |', ...results.map((r) => `| ${r.join(' | ')} |`)].join('\n'))
})

describe('bulk data', () => {
  jest.setTimeout(120000)
  // The sync engine logs each dropped request; about 300 of them here.
  beforeAll(() => jest.spyOn(console, 'error').mockImplementation(() => {}))

  test('a whole term marked offline syncs completely, with no duplicates', async () => {
    const marks = makeMarks(SCHOOLS, STUDENTS_PER_CLASS, TERM_DAYS)
    marks.forEach((m, i) => {
      rows.set(i + 1, { ...m, localId: i + 1, sync_status: 'PENDING', marked_at: `${m.date}T07:30:00Z`, client_request_id: `req-${i + 1}` })
    })
    Object.defineProperty(globalThis, 'navigator', { value: { onLine: true }, configurable: true })

    const start = performance.now()
    await syncPendingAttendance() // first try: about 3% fail
    const failedFirst = [...rows.values()].filter((r) => r.sync_status === 'FAILED').length
    let runs = 1
    while ([...rows.values()].some((r) => r.sync_status !== 'SYNCED') && runs < 10) {
      await syncPendingAttendance() // the next "online" event retries the failed ones
      runs += 1
    }
    const seconds = (performance.now() - start) / 1000

    const all = [...rows.values()]
    expect(all.every((r) => r.sync_status === 'SYNCED' && r.remote_id)).toBe(true)
    expect(accepted.size).toBe(marks.length) // every mark reached the server
    expect([...accepted.values()].every((n) => n === 1)).toBe(true) // and only once
    expect(peakInFlight).toBeLessThanOrEqual(4) // never floods the Lambda
    expect(failedFirst).toBeGreaterThan(0) // the network really did drop some

    results.push(['Sync when back online', `${marks.length.toLocaleString()} marks, 5-25 ms per request, 3% dropped`,
      `${seconds.toFixed(1)} s (${Math.round(marks.length / seconds)} marks/s), ${failedFirst} retried, ${runs} sync runs, ${requests.toLocaleString()} requests, at most ${peakInFlight} at once, 0 lost, 0 duplicates`])
  })

  test('dashboard figures for 100,000 records', () => {
    const records = makeMarks(10, 50, 200).map((m, i) => ({ ...m, id: `r${i}` }))
    expect(records.length).toBe(100000)
    const start = performance.now()
    const weekly = weeklyRates(records)
    const weekdays = weekdayRates(records)
    const split = statusSplit(records)
    const reasons = summarizeReasons(records)
    const ms = performance.now() - start

    expect(weekdays).toHaveLength(5)
    expect(split.reduce((sum, x) => sum + x.count, 0)).toBe(100000)
    expect(reasons.ABSENT.total).toBe(records.filter((r) => r.status === 'ABSENT').length)
    expect(weekly.length).toBeGreaterThan(30)
    expect(ms).toBeLessThan(5000)

    results.push(['Dashboard charts and reasons', '100,000 records (500 students, 200 days)', `${Math.round(ms)} ms`])
  })
})
