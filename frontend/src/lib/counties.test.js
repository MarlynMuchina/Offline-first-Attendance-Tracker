import { COUNTIES, COUNTY_NAMES, matchCounty, countyPosition, schoolPositions } from './counties.js'

describe('COUNTIES', () => {
  it('lists all 47 counties, inside Kenya', () => {
    expect(COUNTY_NAMES).toHaveLength(47)
    for (const [lat, lng] of Object.values(COUNTIES)) {
      expect(lat).toBeGreaterThan(-5)
      expect(lat).toBeLessThan(5.1)
      expect(lng).toBeGreaterThan(33.9)
      expect(lng).toBeLessThan(42)
    }
  })
})

describe('matchCounty', () => {
  it('ignores case, spaces, dashes and the word county', () => {
    expect(matchCounty('machakos')).toBe('Machakos')
    expect(matchCounty(' Taita Taveta County ')).toBe('Taita-Taveta')
    expect(matchCounty('Muranga')).toBe("Murang'a")
  })

  it('returns null for an unknown place', () => {
    expect(matchCounty('Atlantis')).toBeNull()
    expect(matchCounty('')).toBeNull()
    expect(matchCounty(undefined)).toBeNull()
  })
})

describe('countyPosition', () => {
  it('gives the county town position', () => {
    expect(countyPosition('Narok')).toEqual({ lat: -1.0783, lng: 35.8601, county: 'Narok' })
  })
})

describe('schoolPositions', () => {
  it('pins each school at its county and spreads schools in one county', () => {
    const pins = schoolPositions([
      { id: 'A', county: 'Kitui' },
      { id: 'B', county: 'Kitui' },
      { id: 'C', county: 'Nowhere' },
    ])
    expect(pins.map((p) => p.id)).toEqual(['A', 'B'])
    expect(pins[0]).toMatchObject({ lat: -1.3667, lng: 38.0106 })
    expect(pins[1].lat).not.toBe(pins[0].lat)
    expect(Math.abs(pins[1].lat - pins[0].lat)).toBeLessThan(0.1)
  })
})
