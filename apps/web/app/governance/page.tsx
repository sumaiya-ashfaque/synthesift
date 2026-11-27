import type { Metadata } from 'next';
import { GovernanceConsole } from '@/app/components/governance/governance-console';

export const metadata: Metadata = {
  title: 'CI/CD & Governance — SyntheSift',
  description: 'Personal Access Tokens, headless CI/CD quality gates, HMAC-signed webhooks, and immutable workspace audit logs.',
};

export default function GovernancePage() {
  return <GovernanceConsole />;
}
