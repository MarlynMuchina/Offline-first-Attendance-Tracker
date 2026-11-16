import { useNavigate } from 'react-router-dom'
import { BrandMark, Icon } from '../components/AppShell'

const features = [
  { icon: 'offline', title: 'Works offline', desc: 'Mark the register with no signal. It syncs later.', tone: 'blue' },
  { icon: 'sms', title: 'Parents get an SMS', desc: 'Any phone, in English or Kiswahili.', tone: 'teal' },
  { icon: 'spark', title: 'Early warning', desc: 'AI summaries and risk prediction for admins.', tone: 'mist' },
  { icon: 'shield', title: 'Right access', desc: 'Teachers, admins and Angaza each see their part.', tone: 'slate' },
]

const accountSteps = [
  { title: 'Angaza', desc: 'adds a school and its admin.' },
  { title: 'The admin', desc: 'adds the teachers.' },
  { title: 'Teachers', desc: 'sign in and mark the register.' },
  { title: 'Guardians', desc: 'get texts, no login needed.' },
]

export default function Home() {
  const navigate = useNavigate()

  return (
    <div className="home">
      <header className="home-nav">
        <div className="home-brand">
          <BrandMark />
          <div className="brand-text">
            <strong>CSG Attendance</strong>
            <span>Angaza Center</span>
          </div>
        </div>
        <button onClick={() => navigate('/login')} className="btn btn-primary">
          Sign In
        </button>
      </header>

      <section className="home-hero">
        <div className="home-hero-text">
          <span className="home-kicker">For rural schools in Kenya</span>
          <h1>Every child counted, even without internet</h1>
          <p>Take the register offline, keep parents informed and spot students at risk early.</p>
          <button onClick={() => navigate('/login')} className="btn btn-accent">
            Sign In to Get Started
          </button>
        </div>
        <div className="home-hero-photo">
          <img src="/home-students.webp" alt="Two students working together on a laptop in class" width="900" height="1012" />
          <div className="home-roll" aria-hidden="true">
            <span className="home-roll-label">Form 2 North · Today</span>
            <strong>34 of 36 present</strong>
            <span className="home-roll-sync">Saved offline · syncs when back online</span>
          </div>
        </div>
      </section>

      <section className="home-features">
        {features.map((f) => (
          <div key={f.title} className={`home-feature home-feature-${f.tone}`}>
            <span className="home-feature-icon"><Icon name={f.icon} size={22} /></span>
            <h3>{f.title}</h3>
            <p>{f.desc}</p>
          </div>
        ))}
      </section>

      <section className="home-band">
        <img src="/home-angaza.webp" alt="An Angaza Center facilitator helping students at their laptops" width="800" height="800" />
        <div className="home-band-text">
          <h2>How accounts work</h2>
          <p className="subtext" style={{ margin: 0 }}>No sign-up page. Each login is made by the level above.</p>
          <ol className="step-list">
            {accountSteps.map((s) => (
              <li key={s.title}>
                <p><strong>{s.title}</strong> {s.desc}</p>
              </li>
            ))}
          </ol>
        </div>
      </section>

      <footer className="home-footer">
        <p>Need an account? Ask your school administrator.</p>
      </footer>
    </div>
  )
}
