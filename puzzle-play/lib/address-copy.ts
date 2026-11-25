'use client';
import { usePathname } from 'next/navigation';
import { addressCopy } from './address-language';

// See lib/address-language.ts for the rule. This is the client-component wrapper around it.
export function useAddressCopy() {
  const pathname = usePathname() || '';
  return <T,>(text: T): T => addressCopy(pathname, text);
}
