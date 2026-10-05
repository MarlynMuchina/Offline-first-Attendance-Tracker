import { fetchAuthSession } from 'aws-amplify/auth'

/**
 * Returns { schoolId, userId } for the currently signed-in user.
 * schoolId comes from the custom:school_id claim in the Cognito ID token.
 * Throws if the session is missing or the attribute is not set.
 */
export async function getCurrentUserContext() {
  const session = await fetchAuthSession()
  const idToken = session?.tokens?.idToken
  if (!idToken) throw new Error('No active session')

  const schoolId = idToken.payload['custom:school_id']
  const userId = idToken.payload['sub']
  const phoneNumber = idToken.payload['phone_number']

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
 * Returns the first classId found for the given schoolId.
 * Used by Admin (who oversees the whole school, not one specific class) --
 * NOT used by Teacher anymore, since that previously handed every signed-in
 * teacher the same first class regardless of who they actually were.
 * See getClassesForCurrentTeacher below for the real per-teacher lookup.
 */
export async function getClassIdForSchool(schoolId) {
  const items = await listAll(listClassesBySchool, { schoolId }, 'listClasses', { stopAtFirst: true })
  if (!items.length) throw new Error(`No class found for school ${schoolId}`)
  return items[0].id
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

/**
 * Returns the real class(es) belonging to the currently signed-in teacher,
 * resolved via their Cognito sub -> Teacher record -> Class.teacher_id.
 * A Teacher record only resolves here if an admin has linked its
 * cognito_sub field to this user's real login (see project notes on the
 * manual provisioning step -- Cognito accounts are created via CLI, same
 * as every other account in this project, then linked afterward).
 * Returns an array since one teacher can now have multiple classes.
 * Throws if no Teacher record is linked to this login at all.
 */
export async function getClassesForCurrentTeacher(cognitoSub) {
  const [teacherRecord] = await listAll(
    getTeacherByCognitoSub, { sub: cognitoSub }, 'listTeachers', { stopAtFirst: true }
  )
  if (!teacherRecord) {
    throw new Error('No teacher record is linked to this account yet. Ask an admin to link it.')
  }

  const classes = await listAll(listClassesByTeacher, { teacherId: teacherRecord.id }, 'listClasses')
  if (!classes.length) {
    throw new Error('No classes are assigned to you yet.')
  }
  return {
    teacherName: `${teacherRecord.first_name} ${teacherRecord.last_name}`,
    classes,
  }
}