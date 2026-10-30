import Image from 'next/image';
import Link from 'next/link';

export function Brand() {
  return (
    <Link href="/" className="brand" aria-label="SyntheSift home">
      <span className="brand-mark" aria-hidden="true">
        <Image src="/synthesift-mark.svg" alt="" width={40} height={40} />
      </span>
      <span>SyntheSift</span>
    </Link>
  );
}
