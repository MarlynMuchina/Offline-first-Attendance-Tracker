import { useState } from 'react'

// Small SVG charts for the dashboards. They are drawn from data already on
// the page, need no chart library and no internet, and follow the theme
// through CSS variables (see .chart in index.css).

const pctText = (r) => (r === null || r === undefined ? 'no records' : `${Math.round(r * 100)}%`)

// Lowest value on the y axis: 50%, or lower if the data goes lower, rounded
// down to a 10% step so the gridlines stay even.
function axisFloor(values, refs = []) {
  const all = [...values, ...refs.map((r) => r.value)].filter((v) => v !== null && v !== undefined)
  const lowest = all.length ? Math.min(...all) : 0.5
  return Math.max(0, Math.min(0.5, Math.floor((lowest - 0.05) * 10) / 10))
}

function gridSteps(lo) {
  const steps = []
  for (let v = lo; v <= 1.0001; v += 0.1) steps.push(Math.round(v * 10) / 10)
  return steps.filter((v, i) => i % (lo <= 0.2 ? 2 : 1) === 0 || v === 1)
}

function Tooltip({ x, y, children }) {
  return (
    <div className="chart-tip" style={{ left: `${x}%`, top: `${y}%` }} role="status">
      {children}
    </div>
  )
}

// Names the dashed lines under the chart, so their labels never collide.
function RefLegend({ refs }) {
  if (!refs.length) return null
  return (
    <p className="subtext chart-legend">
      {refs.map((ref) => (
        <span key={ref.label}>
          <span className={`rank-ref-key chart-ref-${ref.tone || 'warn'}`} aria-hidden="true" /> {ref.label}
        </span>
      ))}
    </p>
  )
}

function RefLines({ refs, xLeft, xRight, yOf }) {
  return refs.map((r) => (
    <g key={r.label} className={`chart-ref chart-ref-${r.tone || 'warn'}`}>
      <line x1={xLeft} x2={xRight} y1={yOf(r.value)} y2={yOf(r.value)} />
    </g>
  ))
}

/**
 * Line chart of a rate over time (one series).
 * points: [{ key, label, rate, detail? }] oldest first
 * refs: [{ value, label, tone: 'warn' | 'exam' }] dashed reference lines
 */
export function TrendChart({ points, refs = [], title }) {
  const [hover, setHover] = useState(null)
  const W = 420, H = 210, L = 38, R = 8, T = 16, B = 26
  const lo = axisFloor(points.map((p) => p.rate), refs)
  const xOf = (i) => (points.length === 1 ? (L + W - R) / 2 : L + (i * (W - L - R)) / (points.length - 1))
  const yOf = (v) => T + ((1 - v) * (H - T - B)) / (1 - lo)
  const valid = points.map((p, i) => ({ ...p, i })).filter((p) => p.rate !== null)
  const path = valid.map((p, n) => `${n ? 'L' : 'M'}${xOf(p.i)},${yOf(p.rate)}`).join(' ')
  const area = valid.length > 1
    ? `${path} L${xOf(valid[valid.length - 1].i)},${H - B} L${xOf(valid[0].i)},${H - B} Z`
    : ''
  const last = valid[valid.length - 1]
  const step = points.length > 1 ? (W - L - R) / (points.length - 1) : W - L - R
  const labelEvery = Math.ceil(points.length / 5)

  return (
    <div className="chart" onMouseLeave={() => setHover(null)}>
      <svg viewBox={`0 0 ${W} ${H}`} role="img" aria-label={`${title}: ${points.map((p) => `${p.label} ${pctText(p.rate)}`).join(', ')}`}>
        {gridSteps(lo).map((v) => (
          <g key={v} className="chart-grid">
            <line x1={L} x2={W - R} y1={yOf(v)} y2={yOf(v)} />
            <text x={L - 8} y={yOf(v) + 4} textAnchor="end">{Math.round(v * 100)}%</text>
          </g>
        ))}
        <RefLines refs={refs} xLeft={L} xRight={W - R} yOf={yOf} />
        {area && <path d={area} className="chart-area" />}
        <path d={path} className="chart-line" />
        {hover !== null && points[hover].rate !== null && (
          <line className="chart-cross" x1={xOf(hover)} x2={xOf(hover)} y1={T} y2={H - B} />
        )}
        {valid.map((p) => (
          <circle key={p.key} cx={xOf(p.i)} cy={yOf(p.rate)} r={hover === p.i ? 6 : 4} className="chart-dot" />
        ))}
        {last && hover === null && (
          <text x={xOf(last.i)} y={yOf(last.rate) - 12} textAnchor="end" className="chart-label">{pctText(last.rate)}</text>
        )}
        {points.map((p, i) => (
          i % labelEvery === 0 || i === points.length - 1 ? (
            <text key={`x${p.key}`} x={xOf(i)} y={H - 8} textAnchor="middle" className="chart-axis">{p.label}</text>
          ) : null
        ))}
        {points.map((p, i) => (
          <rect
            key={`hit${p.key}`}
            x={xOf(i) - step / 2}
            y={T}
            width={step}
            height={H - T - B}
            className="chart-hit"
            tabIndex={0}
            aria-label={`${p.label}: ${pctText(p.rate)}`}
            onMouseEnter={() => setHover(i)}
            onFocus={() => setHover(i)}
            onBlur={() => setHover(null)}
          />
        ))}
      </svg>
      <RefLegend refs={refs} />
      {hover !== null && (
        <Tooltip x={(xOf(hover) / W) * 100} y={((points[hover].rate !== null ? yOf(points[hover].rate) : T) / H) * 100}>
          <strong>{pctText(points[hover].rate)}</strong>
          <span>{points[hover].label}</span>
          {points[hover].detail && <span>{points[hover].detail}</span>}
        </Tooltip>
      )}
    </div>
  )
}

/**
 * Column chart of a rate per category (one series), e.g. by day of week.
 * rows: [{ key, label, value (0-1 or null), detail? }]
 * The lowest column is labelled; the rest show on hover.
 */
export function ColumnChart({ rows, refs = [], title }) {
  const [hover, setHover] = useState(null)
  const W = 420, H = 210, L = 38, R = 8, T = 16, B = 26
  const lo = axisFloor(rows.map((r) => r.value), refs)
  const yOf = (v) => T + ((1 - v) * (H - T - B)) / (1 - lo)
  const slot = (W - L - R) / rows.length
  const barW = Math.min(40, slot * 0.5)
  const withData = rows.filter((r) => r.value !== null)
  const lowest = withData.length > 1 ? withData.reduce((a, b) => (b.value < a.value ? b : a)) : null

  return (
    <div className="chart" onMouseLeave={() => setHover(null)}>
      <svg viewBox={`0 0 ${W} ${H}`} role="img" aria-label={`${title}: ${rows.map((r) => `${r.label} ${pctText(r.value)}`).join(', ')}`}>
        {gridSteps(lo).map((v) => (
          <g key={v} className="chart-grid">
            <line x1={L} x2={W - R} y1={yOf(v)} y2={yOf(v)} />
            <text x={L - 8} y={yOf(v) + 4} textAnchor="end">{Math.round(v * 100)}%</text>
          </g>
        ))}
        {rows.map((r, i) => {
          const cx = L + slot * i + slot / 2
          if (r.value === null) {
            return <text key={r.key} x={cx} y={H - B - 8} textAnchor="middle" className="chart-axis">no data</text>
          }
          const top = yOf(r.value)
          const h = Math.max(2, H - B - top)
          return (
            <g key={r.key}>
              <rect x={cx - barW / 2} y={top} width={barW} height={h} rx={4} className={`chart-bar${hover === i ? ' is-hover' : ''}`} />
              <rect x={cx - barW / 2} y={H - B - Math.min(4, h)} width={barW} height={Math.min(4, h)} className={`chart-bar${hover === i ? ' is-hover' : ''}`} />
              {lowest === r && hover === null && (
                <text x={cx} y={top - 8} textAnchor="middle" className="chart-label">{pctText(r.value)}</text>
              )}
            </g>
          )
        })}
        <RefLines refs={refs} xLeft={L} xRight={W - R} yOf={yOf} />
        {rows.map((r, i) => (
          <text key={`x${r.key}`} x={L + slot * i + slot / 2} y={H - 8} textAnchor="middle" className="chart-axis">{r.label}</text>
        ))}
        {rows.map((r, i) => (
          <rect
            key={`hit${r.key}`}
            x={L + slot * i}
            y={T}
            width={slot}
            height={H - T - B}
            className="chart-hit"
            tabIndex={0}
            aria-label={`${r.label}: ${pctText(r.value)}`}
            onMouseEnter={() => setHover(i)}
            onFocus={() => setHover(i)}
            onBlur={() => setHover(null)}
          />
        ))}
      </svg>
      <RefLegend refs={refs} />
      {hover !== null && (
        <Tooltip x={((L + slot * hover + slot / 2) / W) * 100} y={((rows[hover].value !== null ? yOf(rows[hover].value) : H - B) / H) * 100}>
          <strong>{pctText(rows[hover].value)}</strong>
          <span>{rows[hover].label}</span>
          {rows[hover].detail && <span>{rows[hover].detail}</span>}
        </Tooltip>
      )}
    </div>
  )
}

/**
 * One bar split into parts, with a legend that names each part and its
 * count, so the colours never carry the meaning alone.
 * segments: [{ key, label, count, share, tone: 'present' | 'late' | 'absent' }]
 */
export function SplitBar({ segments, title }) {
  const shown = segments.filter((s) => s.share > 0)
  return (
    <div className="split">
      <div className="split-bar" role="img" aria-label={`${title}: ${segments.map((s) => `${s.label} ${s.count} (${Math.round(s.share * 100)}%)`).join(', ')}`}>
        {shown.map((s) => (
          <span
            key={s.key}
            className={`split-part split-${s.tone}`}
            style={{ flexGrow: s.share }}
            title={`${s.label}: ${s.count} (${Math.round(s.share * 100)}%)`}
          />
        ))}
      </div>
      <ul className="split-legend">
        {segments.map((s) => (
          <li key={s.key}>
            <span className={`split-key split-${s.tone}`} aria-hidden="true" />
            <span>{s.label}</span>
            <strong>{s.count}</strong>
            <span className="subtext" style={{ margin: 0 }}>{Math.round(s.share * 100)}%</span>
          </li>
        ))}
      </ul>
    </div>
  )
}

/**
 * Horizontal bars of a rate per row, best first, with dashed reference
 * lines (used to compare schools).
 * rows: [{ key, label, value (0-1 or null) }]
 */
export function RankBars({ rows, refs = [], title }) {
  const sorted = [...rows].sort((a, b) => (b.value ?? -1) - (a.value ?? -1))
  return (
    <div className="rank" role="img" aria-label={`${title}: ${sorted.map((r) => `${r.label} ${pctText(r.value)}`).join(', ')}`}>
      {sorted.map((r) => (
        <div key={r.key} className="rank-row">
          <span className="rank-label">{r.label}</span>
          <div className="rank-track">
            {r.value !== null && <div className="rank-fill" style={{ width: `${Math.round(r.value * 100)}%` }} />}
            {refs.map((ref) => (
              <span key={ref.label} className={`rank-ref chart-ref-${ref.tone || 'warn'}`} style={{ left: `${ref.value * 100}%` }} />
            ))}
          </div>
          <strong className="rank-value">{r.value === null ? '—' : pctText(r.value)}</strong>
        </div>
      ))}
      <RefLegend refs={refs} />
    </div>
  )
}
