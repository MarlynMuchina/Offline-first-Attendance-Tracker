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

const listClassesBySchool = /* GraphQL */ `
  query ListClassesBySchool($schoolId: ID!) {
    listClasses(filter: { school_id: { eq: $schoolId } }, limit: 100) {
      items {
        id
        name
      }
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
  const res = await client.graphql({
    query: listClassesBySchool,
    variables: { schoolId },
  })
  const items = res.data.listClasses.items
  if (!items.length) throw new Error(`No class found for school ${schoolId}`)
  return items[0].id
}

const getTeacherByCognitoSub = /* GraphQL */ `
  query GetTeacherByCognitoSub($sub: String!) {
    listTeachers(filter: { cognito_sub: { eq: $sub } }, limit: 1) {
      items {
        id
        first_name
        last_name
      }
    }
  }
`

const listClassesByTeacher = /* GraphQL */ `
  query ListClassesByTeacher($teacherId: ID!) {
    listClasses(filter: { teacher_id: { eq: $teacherId } }, limit: 100) {
      items {
        id
        name
        grade
        stream
      }
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
  const teacherRes = await client.graphql({
    query: getTeacherByCognitoSub,
    variables: { sub: cognitoSub },
  })
  const teacherRecord = teacherRes.data.listTeachers.items[0]
  if (!teacherRecord) {
    throw new Error('No teacher record is linked to this account yet. Ask an admin to link it.')
  }

  const classesRes = await client.graphql({
    query: listClassesByTeacher,
    variables: { teacherId: teacherRecord.id },
  })
  const classes = classesRes.data.listClasses.items
  if (!classes.length) {
    throw new Error('No classes are assigned to you yet.')
  }
  return {
    teacherName: `${teacherRecord.first_name} ${teacherRecord.last_name}`,
    classes,
  }
}