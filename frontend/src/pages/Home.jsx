import { useNavigate } from 'react-router-dom'

const features = [
  {
    title: 'Works Without Internet',
    desc: 'Teachers mark attendance offline — records queue locally and sync automatically the moment connectivity returns.',
  },
  {
    title: 'Role-Based Access',
    desc: 'Teachers, administrators, and head teachers each see exactly what their role needs — nothing more.',
  },
  {
    title: 'AI-Powered Insights',
    desc: 'Generate plain-language attendance summaries and trend analysis in seconds, powered by Claude.',
  },
  {
    title: 'Instant Parent Alerts',
    desc: 'Automatic SMS notifications to guardians when a student crosses an absence threshold — no internet required on their end.',
  },
]

export default function Home() {
  const navigate = useNavigate()

  return (
    <div>
      <header className="home-nav">
        <div className="home-nav-inner">
          <span className="home-logo">ConnectED Attendance</span>
          <button onClick={() => navigate('/login')} className="btn btn-primary btn-small">
            Sign In
          </button>
        </div>
      </header>

      <section className="home-hero">
        <h1>Attendance tracking built for schools without reliable internet</h1>
        <p className="home-hero-sub">
          Offline-first, AI-assisted, and built specifically for rural Kenyan schools —
          take attendance with no connection, get instant insights, keep parents informed.
        </p>
        <button onClick={() => navigate('/login')} className="btn btn-primary" style={{ padding: '12px 28px', fontSize: 15 }}>
          Sign In to Get Started
        </button>
      </section>

      <section className="home-features">
        {features.map((f) => (
          <div key={f.title} className="home-feature-card">
            <h3>{f.title}</h3>
            <p>{f.desc}</p>
          </div>
        ))}
      </section>

      <footer className="home-footer">
        <p>Need an account? Contact your school administrator — accounts are issued, not self-registered.</p>
      </footer>
    </div>
  )
}