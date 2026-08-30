import { mockAttendanceDashboard } from '../mocks/fixtures'

// Admin dashboard — trend view + chronic absenteeism (US-07, US-09).
// Claude AI summary panel (US-08) is reserved layout space — that's Sprint 2 work.
// Sprint 1: replace mockAttendanceDashboard with getAttendanceDashboard(school_id, term_id).
export default function Admin() {
  const { attendance_rate, chronic_absenteeism_count, class_summaries } = mockAttendanceDashboard

  return (
    <div style={{ maxWidth: 800, margin: '40px auto', fontFamily: 'sans-serif' }}>
      <h2>Administrator Dashboard</h2>

      <div style={{ display: 'flex', gap: 16, marginBottom: 24 }}>
        <div style={{ flex: 1, border: '1px solid #ddd', borderRadius: 6, padding: 16 }}>
          <h4>Attendance Trend</h4>
          <p style={{ fontSize: 28, margin: 0 }}>{Math.round(attendance_rate * 100)}%</p>
          <p style={{ color: '#888', fontSize: 12 }}>Term-to-date average</p>
        </div>
        <div style={{ flex: 1, border: '1px dashed #999', borderRadius: 6, padding: 16, background: '#fafafa' }}>
          <h4>AI Summary (Claude via Bedrock)</h4>
          <p style={{ color: '#999', fontSize: 12 }}>Reserved for Sprint 2 — plain-language summary will render here.</p>
        </div>
      </div>

      <h4>Students Below 70% Attendance ({chronic_absenteeism_count})</h4>
      <table style={{ width: '100%', borderCollapse: 'collapse' }}>
        <thead>
          <tr style={{ textAlign: 'left', borderBottom: '1px solid #ccc' }}>
            <th>Class</th>
            <th>Attendance rate</th>
            <th>Absences</th>
          </tr>
        </thead>
        <tbody>
          {class_summaries.map((c) => (
            <tr key={c.class_id} style={{ borderBottom: '1px solid #eee' }}>
              <td style={{ padding: '8px 0' }}>{c.class_id}</td>
              <td>{Math.round(c.attendance_rate * 100)}%</td>
              <td>{c.absent_count}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  )
}
