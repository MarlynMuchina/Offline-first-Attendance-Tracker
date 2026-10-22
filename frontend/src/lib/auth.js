import { fetchAuthSession } from 'aws-amplify/auth'
import { rememberSession, readRememberedSession } from './offlineSession'

// How long to wait for Amplify to refresh an expired token before using the
// saved sign-in. On a connection with no real internet the refresh can hang.
const REFRESH_WAIT_MS = 10000

/**
 * Returns { groups, schoolId, userId, phoneNumber, savedCopy } for the
 * signed-in user, read from the Cognito ID token. Each good read is saved on
 * the device. Offline, the saved copy is used straight away, without asking
 * Amplify: an expired token would start a refresh that can hang, and Amplify
 * makes later calls wait for that same refresh, which would hold up the sync
 * once the internet is back. Online, the saved copy is also used if Amplify
 * throws or takes too long. Either way it comes back with savedCopy: true.
 * A signed-out device has no tokens and no saved copy, so it still goes to
 * the login page.
 */
export async function getSignedInSession({ forceRefresh = false } = {}) {
  const saved = readRememberedSession()
  if (!navigator.onLine && saved) return { ...saved, savedCopy: true }

  let session
  try {
    let timer
    session = await Promise.race([
      fetchAuthSession(forceRefresh ? { forceRefresh: true } : undefined),
      new Promise((_, reject) => {
        timer = setTimeout(() => reject(new Error('Sign-in check took too long')), REFRESH_WAIT_MS)
      }),
    ]).finally(() => clearTimeout(timer))
  } catch (err) {
    if (saved) return { ...saved, savedCopy: true }
    throw err
  }
  const idToken = session?.tokens?.idToken
  if (!idToken) throw new Error('No active session')

  const info = {
    groups: idToken.payload['cognito:groups'] || [],
    schoolId: idToken.payload['custom:school_id'],
    userId: idToken.payload['sub'],
    phoneNumber: idToken.payload['phone_number'],
  }
  rememberSession(info)
  return { ...info, savedCopy: false }
}

/**
 * Returns { schoolId, userId, phoneNumber } for the currently signed-in user.
 * schoolId comes from the custom:school_id claim in the Cognito ID token.
 * Throws if the session is missing or the attribute is not set.
 */
export async function getCurrentUserContext() {
  const { schoolId, userId, phoneNumber } = await getSignedInSession()
  if (!schoolId) throw new Error('school_id not set on this user account')
  return { schoolId, userId, phoneNumber }
}

import { generateClient } from 'aws-amplify/api'

const client = generateClient()

/**
 * Runs a filtered list query and follows nextToken until it finds a match or
 * runs out of pages. AppSync applies `limit` to the DynamoDB scan BEFORE the
 * filter, so a single page can come back with empty items even though a
 * matching record exists further on (with a non-null nextToken).
 * Pass stopAtFirst to return as soon as any page yields an item.
 */
async function listAll(query, variables, listField, { stopAtFirst = false } = {}) {
  const items = []
  let nextToken = null
  do {
    const res = await client.graphql({ query, variables: { ...variables, nextToken } })
    const page = res.data[listField]
    items.push(...page.items.filter(Boolean))
    if (stopAtFirst && items.length) break
    nextToken = page.nextToken
  } while (nextToken)
  return items
}

const listClassesBySchool = /* GraphQL */ `
  query ListClassesBySchool($schoolId: ID!, $nextToken: String) {
    listClasses(filter: { school_id: { eq: $schoolId } }, limit: 100, nextToken: $nextToken) {
      items {
        id
        name
      }
      nextToken
    }
  }
`

/**
 * Returns every class in the given school, sorted by name.
 * Used by the Admin dashboard's class picker.
 */
export async function getClassesForSchool(schoolId) {
  const items = await listAll(listClassesBySchool, { schoolId }, 'listClasses')
  if (!items.length) throw new Error(`No class found for school ${schoolId}`)
  return [...items].sort((a, b) => a.name.localeCompare(b.name))
}

const getTeacherByCognitoSub = /* GraphQL */ `
  query GetTeacherByCognitoSub($sub: String!, $nextToken: String) {
    listTeachers(filter: { cognito_sub: { eq: $sub } }, limit: 100, nextToken: $nextToken) {
      items {
        id
        first_name
        last_name
      }
      nextToken
    }
  }
`

const listClassesByTeacher = /* GraphQL */ `
  query ListClassesByTeacher($teacherId: ID!, $nextToken: String) {
    listClasses(filter: { teacher_id: { eq: $teacherId } }, limit: 100, nextToken: $nextToken) {
      items {
        id
        name
        grade
        stream
      }
      nextToken
    }
  }
`

function notAssigned(message) {
  return Object.assign(new Error(message), { notAssigned: true })
}

/**
 * Returns the real class(es) belonging to the currently signed-in teacher,
 * resolved via their Cognito sub -> Teacher record -> Class.teacher_id.
 * A Teacher record only resolves here if an admin has linked its
 * cognito_sub field to this user's real login (see project notes on the
 * manual provisioning step -- Cognito accounts are created via CLI, same
 * as every other account in this project, then linked afterward).
 * Returns an array since one teacher can now have multiple classes.
 * Throws if no Teacher record is linked to this login, or it has no
 * classes. Both errors carry notAssigned: true, so callers can tell them
 * apart from a failed network call.
 */
export async function getClassesForCurrentTeacher(cognitoSub) {
  const [teacherRecord] = await listAll(
    getTeacherByCognitoSub, { sub: cognitoSub }, 'listTeachers', { stopAtFirst: true }
  )
  if (!teacherRecord) {
    throw notAssigned('No teacher record is linked to this account yet. Ask an admin to link it.')
  }

  const classes = await listAll(listClassesByTeacher, { teacherId: teacherRecord.id }, 'listClasses')
  if (!classes.length) {
    throw notAssigned('No classes are assigned to you yet.')
  }
  return {
    teacherName: `${teacherRecord.first_name} ${teacherRecord.last_name}`,
    classes,
  }
}