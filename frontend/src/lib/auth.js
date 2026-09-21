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

  if (!schoolId) throw new Error('school_id not set on this user account')

  return { schoolId, userId }
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
 * When each school has exactly one class this is unambiguous.
 * Extend to a class-picker UI once multi-class schools are needed.
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