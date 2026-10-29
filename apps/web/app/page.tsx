import { StatusPanel } from './components/status-panel';
import { getSystemStatus } from '@/lib/system-health';

export const dynamic = 'force-dynamic';

const milestones = [
  { label: 'M0', name: 'Engineering foundation', state: 'Current', description: 'Application shells, API, worker, storage dependencies and CI.' },
  { label: 'M1', name: 'Dataset admission', state: 'Planned', description: 'Authentication, workspace access, CSV ingestion and immutable artifact creation.' },
  { label: 'M2', name: 'Quality profiling', state: 'Planned', description: 'Reproducible statistics, deterministic rules and diagnostic charts.' },
  { label: 'M3+', name: 'AI-guided remediation', state: 'Planned', description: 'Gemini reasoning, guarded proposals, preview, approval and reporting.' },
];

export default async function Home() {
  const status = await getSystemStatus();

  return (
    <main className="site-shell">
      <header className="topbar">
        <div className="brand"><div className="brand-mark" aria-hidden="true">S</div><span>SyntheSift</span></div>
        <span className="build-label">Engineering foundation · v0.1.0</span>
      </header>

      <section className="hero">
        <p className="eyebrow">M0 / Platform bootstrap</p>
        <h1>Trust begins with<br /><span>verifiable foundations.</span></h1>
        <p className="lead">SyntheSift is an AI-assisted data quality analysis and remediation platform under development. This milestone establishes the service boundaries and operational tooling before introducing dataset processing.</p>
        <div className="hero-actions">
          <a className="primary-link" href="/api/docs/" target="_blank" rel="noreferrer">Explore API contract ↗</a>
          <a className="secondary-link" href="/api/v1/meta" target="_blank" rel="noreferrer">Service metadata ↗</a>
        </div>
      </section>

      <div className="content-grid">
        <StatusPanel status={status} />
        <section className="panel" aria-labelledby="delivery-title">
          <div className="section-head">
            <div><p className="eyebrow">Release plan</p><h2 id="delivery-title">Delivery milestones</h2></div>
          </div>
          <div className="milestones">
            {milestones.map((milestone) => (
              <div className="milestone" key={milestone.label}>
                <span className="milestone-id">{milestone.label}</span>
                <div>
                  <div className="milestone-title"><strong>{milestone.name}</strong><span>{milestone.state}</span></div>
                  <p className="muted">{milestone.description}</p>
                </div>
              </div>
            ))}
          </div>
        </section>
      </div>
      <footer className="footer"><span>SyntheSift · Foundation milestone</span><span>Dataset features are not available in M0.</span></footer>
    </main>
  );
}
