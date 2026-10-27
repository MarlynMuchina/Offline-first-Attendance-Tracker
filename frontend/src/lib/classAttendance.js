// Attendance records for one class between two dates, for the admin dashboard.
//
// The plain list query filters the whole attendance table, so it pages
// through every school's records (about 9 pages for the imported data) and
// gets slower as the table grows. The byClassDate index (class_id + date)
// reads only the class's records for those dates.
//
// If the API doesn't offer the index query, it falls back to the list query
// once and keeps using it, so the dashboard still works.

const byClassDateQuery = /* GraphQL */ `
  query AttendanceByClassAndDate($classId: ID!, $startDate: String!, $endDate: String!, $nextToken: String) {
    attendanceRecordsByClass_idAndDate(
      class_id: $classId
      date: { between: [$startDate, $endDate] }
      limit: 1000
      nextToken: $nextToken
    ) {
      items {
        id
        student_id
        date
        status
      }
      nextToken
    }
  }
`

const listQuery = /* GraphQL */ `
  query ListAttendanceByClassAndRange($classId: ID, $startDate: String, $endDate: String, $nextToken: String) {
    listAttendanceRecords(
      filter: {
        class_id: { eq: $classId }
        date: { between: [$startDate, $endDate] }
      }
      limit: 1000
      nextToken: $nextToken
    ) {
      items {
        id
        student_id
        date
        status
      }
      nextToken
    }
  }
`

let indexMissing = false

async function allPages(graphql, query, variables, resultKey) {
  let items = []
  let nextToken = null
  do {
    const res = await graphql({ query, variables: { ...variables, nextToken } })
    const page = res.data[resultKey]
    items = items.concat(page.items)
    nextToken = page.nextToken
  } while (nextToken)
  return items
}

// AppSync answers an unknown query field with a validation error.
function isMissingField(err) {
  const messages = (err?.errors || [err]).map((e) => e?.message || '')
  return messages.some((m) => m.includes('FieldUndefined') || m.includes('attendanceRecordsByClass_idAndDate'))
}

export async function fetchClassAttendance(graphql, { classId, startDate, endDate }) {
  const variables = { classId, startDate, endDate }
  if (!indexMissing) {
    try {
      return await allPages(graphql, byClassDateQuery, variables, 'attendanceRecordsByClass_idAndDate')
    } catch (err) {
      if (!isMissingField(err)) throw err
      indexMissing = true
      console.warn('The class and date index query is not available, so the full list is used instead.')
    }
  }
  return allPages(graphql, listQuery, variables, 'listAttendanceRecords')
}

export function resetForTests() {
  indexMissing = false
}
