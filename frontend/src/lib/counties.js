// Kenya's 47 counties with the approximate position of each county's
// headquarters town. A school is pinned at its county headquarters, so the
// map shows the right area of the country without claiming an exact spot
// (the pilot schools have a county but no recorded location).

export const COUNTIES = {
  Baringo: [0.4919, 35.743],
  Bomet: [-0.7813, 35.3416],
  Bungoma: [0.5635, 34.5606],
  Busia: [0.4608, 34.1115],
  'Elgeyo-Marakwet': [0.6703, 35.5081],
  Embu: [-0.5389, 37.4596],
  Garissa: [-0.4532, 39.6461],
  'Homa Bay': [-0.5273, 34.4571],
  Isiolo: [0.3546, 37.5822],
  Kajiado: [-1.8524, 36.7768],
  Kakamega: [0.2827, 34.7519],
  Kericho: [-0.3689, 35.2863],
  Kiambu: [-1.1714, 36.8356],
  Kilifi: [-3.6305, 39.8499],
  Kirinyaga: [-0.4989, 37.2803],
  Kisii: [-0.6817, 34.768],
  Kisumu: [-0.0917, 34.768],
  Kitui: [-1.3667, 38.0106],
  Kwale: [-4.1816, 39.4606],
  Laikipia: [0.0167, 37.0722],
  Lamu: [-2.2717, 40.902],
  Machakos: [-1.5177, 37.2634],
  Makueni: [-1.7833, 37.6333],
  Mandera: [3.9373, 41.8569],
  Marsabit: [2.3346, 37.9899],
  Meru: [0.047, 37.6498],
  Migori: [-1.0634, 34.4731],
  Mombasa: [-4.0435, 39.6682],
  "Murang'a": [-0.721, 37.1526],
  Nairobi: [-1.2921, 36.8219],
  Nakuru: [-0.3031, 36.08],
  Nandi: [0.2037, 35.105],
  Narok: [-1.0783, 35.8601],
  Nyamira: [-0.5669, 34.9341],
  Nyandarua: [-0.27, 36.38],
  Nyeri: [-0.4201, 36.9476],
  Samburu: [1.0968, 36.698],
  Siaya: [0.0612, 34.2881],
  'Taita-Taveta': [-3.3986, 38.36],
  'Tana River': [-1.499, 40.03],
  'Tharaka-Nithi': [-0.3333, 37.65],
  'Trans Nzoia': [1.0157, 35.0062],
  Turkana: [3.1191, 35.5973],
  'Uasin Gishu': [0.5143, 35.2698],
  Vihiga: [0.0833, 34.7167],
  Wajir: [1.7471, 40.0573],
  'West Pokot': [1.2389, 35.1119],
}

export const COUNTY_NAMES = Object.keys(COUNTIES)

// 'machakos county', ' Taita Taveta ', 'Muranga' -> the key used above.
function normalise(name) {
  return (name || '')
    .toLowerCase()
    .replace(/\bcounty\b/g, '')
    .replace(/[^a-z]/g, '')
}

const BY_KEY = Object.fromEntries(COUNTY_NAMES.map((n) => [normalise(n), n]))

/** The county's name as listed above, or null if it isn't a Kenyan county. */
export function matchCounty(name) {
  return BY_KEY[normalise(name)] || null
}

/** { lat, lng, county } for a school's county headquarters, or null. */
export function countyPosition(name) {
  const county = matchCounty(name)
  if (!county) return null
  const [lat, lng] = COUNTIES[county]
  return { lat, lng, county }
}

/**
 * Map positions for a list of schools ({ id, county }). Schools in the same
 * county are spread a little around the county town so their pins don't
 * sit on top of each other. Schools with an unknown county are left out.
 */
export function schoolPositions(schools) {
  const seen = {}
  const out = []
  for (const s of schools) {
    const pos = countyPosition(s.county)
    if (!pos) continue
    const n = (seen[pos.county] = (seen[pos.county] || 0) + 1) - 1
    const angle = n * 2.4
    const r = n === 0 ? 0 : 0.06 * Math.sqrt(n)
    out.push({ ...s, lat: pos.lat + r * Math.sin(angle), lng: pos.lng + r * Math.cos(angle), county: pos.county })
  }
  return out
}
