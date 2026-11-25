import { networkInterfaces } from 'node:os';

export function localAddress(interfaces = networkInterfaces()) {
  for (const addresses of Object.values(interfaces)) {
    for (const info of addresses || []) {
      if (info.internal || info.family !== 'IPv4') continue;
      const [a,b] = info.address.split('.').map(Number);
      if (a === 10 || (a === 192 && b === 168) || (a === 172 && b >= 16 && b <= 31)) return info.address;
    }
  }
  return '127.0.0.1';
}
