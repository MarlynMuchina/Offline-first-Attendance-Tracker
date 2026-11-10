import { useEffect, useRef } from 'react'
import L from 'leaflet'
import 'leaflet/dist/leaflet.css'
import { schoolPositions } from '../lib/counties'

// Map of the network's schools on OpenStreetMap. Each school is pinned at
// its county headquarters town (see lib/counties.js). The pin colour follows
// the school's attendance, and the popup says it in words too.
// The map tiles come from the internet, like the rest of this page.

const pct = (r) => (r === null || r === undefined ? 'no records' : `${Math.round(r * 100)}%`)

function toneFor(rate, warningLine, examLine) {
  if (rate === null || rate === undefined) return 'none'
  if (rate < examLine) return 'exam'
  if (rate < warningLine) return 'warn'
  return 'ok'
}

const TONE_COLOURS = {
  ok: '--chart-present',
  warn: '--chart-late',
  exam: '--chart-absent',
  none: '--muted',
}

function escapeHtml(text) {
  return String(text).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]))
}

/**
 * schools: [{ id, name, county, rate, students, belowWarning }]
 */
export default function SchoolMap({ schools, warningLine, examLine }) {
  const boxRef = useRef(null)
  const mapRef = useRef(null)
  const layerRef = useRef(null)

  useEffect(() => {
    const map = L.map(boxRef.current, { scrollWheelZoom: false, attributionControl: true })
    L.tileLayer('https://tile.openstreetmap.org/{z}/{x}/{y}.png', {
      maxZoom: 18,
      attribution: '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors',
    }).addTo(map)
    map.setView([0.2, 37.9], 6)
    mapRef.current = map
    layerRef.current = L.layerGroup().addTo(map)
    return () => {
      map.remove()
      mapRef.current = null
    }
  }, [])

  useEffect(() => {
    const map = mapRef.current
    const layer = layerRef.current
    if (!map || !layer) return
    layer.clearLayers()
    const styles = getComputedStyle(document.documentElement)
    const pins = schoolPositions(schools)
    for (const s of pins) {
      const tone = toneFor(s.rate, warningLine, examLine)
      const colour = styles.getPropertyValue(TONE_COLOURS[tone]).trim() || '#00639F'
      const status =
        tone === 'exam' ? 'Below the exam line' : tone === 'warn' ? 'Below the warning line' : tone === 'ok' ? 'On track' : 'No records yet'
      L.circleMarker([s.lat, s.lng], {
        radius: 10,
        color: '#ffffff',
        weight: 2,
        fillColor: colour,
        fillOpacity: 0.95,
      })
        .bindTooltip(escapeHtml(s.name), { direction: 'top', offset: [0, -8] })
        .bindPopup(
          `<strong>${escapeHtml(s.name)}</strong><br>` +
            `${escapeHtml(s.county)} County (pinned at the county town)<br>` +
            `Attendance: <strong>${pct(s.rate)}</strong> · ${escapeHtml(status)}<br>` +
            `${s.students} students, ${s.belowWarning} below the warning line`
        )
        .addTo(layer)
    }
    if (pins.length > 1) {
      map.fitBounds(L.latLngBounds(pins.map((p) => [p.lat, p.lng])), { padding: [40, 40], maxZoom: 9 })
    } else if (pins.length === 1) {
      map.setView([pins[0].lat, pins[0].lng], 9)
    }
  }, [schools, warningLine, examLine])

  return <div ref={boxRef} className="school-map" role="region" aria-label="Map of the network's schools" />
}
