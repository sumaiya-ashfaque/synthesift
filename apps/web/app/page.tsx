import Link from 'next/link';

export default function Home() {
  return (
    <main className="site-shell">
      <header className="topbar">
        <div className="brand"><span className="brand-mark" aria-hidden="true">S</span>SyntheSift</div>
        <Link className="secondary-link" href="/login">Sign in</Link>
      </header>
      <section className="hero">
        <p className="eyebrow">AI-assisted data quality engineering</p>
        <h1>More reliable data.<br /><span>Better decisions.</span></h1>
        <p className="lead">Organize datasets into secure projects. SyntheSift is being built to identify data-quality issues and guide controlled remediation using verified evidence.</p>
        <div className="hero-actions">
          <Link className="primary-link" href="/register">Create an account</Link>
          <Link className="secondary-link" href="/login">Open your workspaces</Link>
        </div>
      </section>
      <section className="panel" aria-label="Product capabilities">
        <h2>Data quality, from intake to validation.</h2>
        <p className="muted">Workspace and project management are available. Dataset uploads, profiling, AI recommendations and transformation execution are upcoming capabilities.</p>
      </section>
    </main>
  );
}
