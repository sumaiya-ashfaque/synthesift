import Link from 'next/link';
import { ThemeToggle } from '@/app/components/theme-toggle';

type Destination = 'overview' | 'library' | 'workbench' | 'manage-data';

type Props = { current: Destination };

type SymbolName = 'overview' | 'library' | 'workbench' | 'manage';

function NavigationIcon({ name }: { name: SymbolName }) {
  const common = { fill: 'none', stroke: 'currentColor', strokeWidth: 1.8,
    strokeLinecap: 'round' as const, strokeLinejoin: 'round' as const };
  return (
    <svg aria-hidden="true" viewBox="0 0 24 24" width="19" height="19" {...common}>
      {name === 'overview' && <>
        <rect x="3" y="3" width="7" height="7" rx="1.5" />
        <rect x="14" y="3" width="7" height="7" rx="1.5" />
        <rect x="3" y="14" width="7" height="7" rx="1.5" />
        <rect x="14" y="14" width="7" height="7" rx="1.5" />
      </>}
      {name === 'library' && <>
        <path d="M4 5h16v14H4zM8 9h8M8 13h5" />
      </>}
      {name === 'workbench' && <>
        <ellipse cx="12" cy="5.5" rx="8" ry="2.6" />
        <path d="M4 5.5V12c0 1.5 3.6 2.7 8 2.7s8-1.2 8-2.7V5.5M4 12v6.3c0 1.5 3.6 2.7 8 2.7s8-1.2 8-2.7V12" />
      </>}
      {name === 'manage' && <>
        <rect x="4" y="6" width="16" height="14" rx="2" />
        <path d="M8 6V4h8v2M9 11h6M9 15h4" />
      </>}
    </svg>
  );
}

const destinations: ReadonlyArray<{
  key: Destination; href: string; label: string; icon: SymbolName; detail: string;
}> = [
  { key: 'overview', href: '/workspaces', label: 'Overview', icon: 'overview', detail: 'Workspaces and projects' },
  { key: 'library', href: '/dataset-library', label: 'Dataset library', icon: 'library', detail: 'Upload and find accessible CSV datasets' },
  { key: 'workbench', href: '/workbench', label: 'Data workbench', icon: 'workbench', detail: 'Profiles, findings and history' },
  { key: 'manage-data', href: '/manage-data', label: 'Manage data', icon: 'manage', detail: 'Deletion and governance' },
];

export function ProductNavigation({ current }: Props) {
  return (
    <nav className="ss-product-navigation" aria-label="Primary navigation">
      <span className="ss-product-nav-label">WORKSPACE</span>
      {destinations.map(({ key, href, label, icon, detail }) => (
        <Link href={href} key={key} className={`ss-product-nav-link ${current === key ? 'is-current' : ''}`}
          aria-current={current === key ? 'page' : undefined} title={detail}>
          <NavigationIcon name={icon} />
          <span>{label}</span>
        </Link>
      ))}
      <ThemeToggle />
      <p className="ss-product-nav-footnote">Evidence first. Every change reviewed.</p>
    </nav>
  );
}
