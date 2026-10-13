// School directory for the CSG pilot, from CSG_Schools_Master.csv. There is
// no School table in the schema, so school names live here. Data for a
// school id that isn't listed still shows, under its raw id.
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

export function schoolName(id) {
  return SCHOOLS[id]?.name || id
}
