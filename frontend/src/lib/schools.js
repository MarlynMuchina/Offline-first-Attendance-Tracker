// School directory for the CSG pilot, from CSG_Schools_Master.csv. Schools
// Angaza adds later (SCH06 onwards) come from the server and are kept on the
// device, so their names also show offline. Data for a school id that isn't
// known yet still shows, under its raw id.
export const SCHOOLS = {
  SCH01: { name: 'Baraka Mixed Secondary School', type: 'Mixed', county: 'Machakos' },
  SCH02: { name: 'Girls Secondary School (SCH02)', type: 'Girls', county: 'Makueni' },
  SCH03: { name: 'Girls Secondary School (SCH03)', type: 'Girls', county: 'Kitui' },
  SCH04: { name: 'Boys Secondary School (SCH04)', type: 'Boys', county: 'Kajiado' },
  SCH05: { name: 'Boys Secondary School (SCH05)', type: 'Boys', county: 'Narok' },
}

// Angaza staff accounts carry this value in custom:school_id instead of a
// real school. They sign in to the network view across every school.
export const NETWORK_SCHOOL_ID = 'ANGAZA'

const SAVED_KEY = 'csg.schools'

function savedSchools() {
  try {
    return JSON.parse(localStorage.getItem(SAVED_KEY)) || {}
  } catch {
    return {}
  }
}

// Every school the app knows: the pilot five plus any Angaza added.
export function allSchools() {
  return { ...savedSchools(), ...SCHOOLS }
}

export function rememberSchools(list) {
  const saved = savedSchools()
  for (const s of list) saved[s.school_id] = { name: s.name, type: s.type, county: s.county }
  try {
    localStorage.setItem(SAVED_KEY, JSON.stringify(saved))
  } catch {
    // storage blocked: names still show for this visit
  }
}

export function schoolName(id) {
  return allSchools()[id]?.name || id
}

const listSchoolsMutation = /* GraphQL */ `
  mutation ListSchools($input: ManageSchoolAdminsInput!) {
    manageSchoolAdmins(input: $input) {
      schools { school_id name type county }
    }
  }
`

// Fetches the schools Angaza added and keeps them on the device. Returns
// false when offline or when the list can't be read; the saved copy stays.
export async function refreshSchools(graphql) {
  if (!navigator.onLine) return false
  try {
    const res = await graphql({ query: listSchoolsMutation, variables: { input: { action: 'LIST_SCHOOLS' } } })
    rememberSchools(res.data.manageSchoolAdmins.schools || [])
    return true
  } catch (err) {
    console.warn('Could not load the school list:', err)
    return false
  }
}
