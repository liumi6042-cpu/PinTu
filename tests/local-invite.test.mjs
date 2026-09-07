import test from 'node:test';
import assert from 'node:assert/strict';
import { localAddress } from '../scripts/local-address.mjs';
import { isLocalHostname, roomInviteTarget } from '../lib/room-invite.ts';
const id='1234567890abcdef1234567890abcdef';

test('local invitations retain the host computer address when joining from another server',()=>{
  assert.equal(roomInviteTarget(`http://10.0.0.195:3000/room/${id}`,'http://localhost:3000',true),`http://10.0.0.195:3000/room/${id}`);
  assert.equal(roomInviteTarget(id,'http://localhost:3000',true),`http://localhost:3000/room/${id}`);
  assert.equal(roomInviteTarget(`/room/${id}/?extra=1`,'http://localhost:3000',true),`http://localhost:3000/room/${id}`);
});
test('local mode rejects public invitations and invalid URL schemes',()=>{
  for(const url of [`https://example.com/room/${id}`,`javascript:alert(1)`,`file:///room/${id}`,`http://user:pass@10.0.0.195:3000/room/${id}`,`/room/invalid`]){
    assert.throws(()=>roomInviteTarget(url,'http://localhost:3000',true));
  }
  assert.equal(roomInviteTarget(`https://example.com/room/${id}`,'https://example.com',false),`https://example.com/room/${id}`);
});
test('local addresses exclude VPN benchmark, public and link-local addresses',()=>{
  for(const address of ['localhost','127.0.0.1','[::1]','10.0.0.195','192.168.1.10','172.16.1.2','172.31.254.1'])assert.ok(isLocalHostname(address));
  for(const address of ['198.18.0.1','169.254.181.0','172.32.1.2','8.8.8.8','10.0.0.256','example.com'])assert.equal(isLocalHostname(address),false);
  const address=ip=>[{family:'IPv4',internal:false,address:ip}];
  assert.equal(localAddress({FlClash:address('198.18.0.1'),Unused:address('169.254.181.0'),Ethernet:address('10.0.0.195')}),'10.0.0.195');
  assert.equal(localAddress({}),'127.0.0.1');
});
