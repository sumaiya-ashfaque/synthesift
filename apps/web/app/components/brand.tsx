import Image from 'next/image';
import Link from 'next/link';
import { cn } from '@/lib/cn';

export function Brand({ compact = false, className }: { compact?: boolean; className?: string }) {
  return (
    <Link
      href="/"
      className={cn(
        'inline-flex items-center gap-2.5 text-[var(--ss-text)] no-underline group',
        className,
      )}
      aria-label="SyntheSift home"
    >
      <span className="inline-flex h-7 w-7 shrink-0 items-center justify-center overflow-hidden rounded-md border border-[var(--ss-border)] bg-[var(--ss-surface)]">
        <Image src="/synthesift-mark.svg" alt="" width={28} height={28} />
      </span>
      {!compact && (
        <span className="text-[15px] font-semibold tracking-[-0.025em]">
          SyntheSift
        </span>
      )}
    </Link>
  );
}
