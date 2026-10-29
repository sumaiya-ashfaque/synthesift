import type { SystemStatus } from '@/lib/system-health';

interface Props {
  status: SystemStatus;
}

const humanState = (value: boolean): string => (value ? 'Operational' : 'Unavailable');

export function StatusPanel({ status }: Props) {
  const systems = [
    { name: 'Django API', detail: 'HTTP application', operational: status.live },
    { name: 'PostgreSQL', detail: 'Persistence layer', operational: status.dependencies.database === 'ok' },
    { name: 'Redis', detail: 'Task broker', operational: status.dependencies.redis === 'ok' },
  ];

  return (
    <section className="panel" aria-labelledby="system-title">
      <div className="section-head">
        <div>
          <p className="eyebrow">Local environment</p>
          <h2 id="system-title">System readiness</h2>
        </div>
        <span className={`pill ${status.ready ? 'pill-good' : 'pill-bad'}`} role="status">
          {status.ready ? 'Ready' : 'Degraded'}
        </span>
      </div>
      <p className="muted">These checks reflect live API and dependency connectivity. Worker execution is verified separately.</p>
      <div className="services">
        {systems.map((service) => (
          <div className="service" key={service.name}>
            <div>
              <strong>{service.name}</strong>
              <p className="muted">{service.detail}</p>
            </div>
            <span className={`service-state ${service.operational ? 'healthy' : 'unhealthy'}`}>
              <span className="indicator" aria-hidden="true" />
              {humanState(service.operational)}
            </span>
          </div>
        ))}
      </div>
      <div className="panel-footer">
        <a href="/api/v1/health/ready" target="_blank" rel="noreferrer">Inspect readiness JSON ↗</a>
        <a href="/api/docs/" target="_blank" rel="noreferrer">Browse API documentation ↗</a>
      </div>
    </section>
  );
}
