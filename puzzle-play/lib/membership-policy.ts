// Payment and subscription grants are not available in this local preview.
// Adding an actual membership later must use a server-verified entitlement.
export const MEMBERSHIP_LAUNCHED = false;
export const MEMBER_ROOM_LIMIT=3,ROOM_PLAYER_LIMIT=8;
export type MembershipRecord={plan:'puzzle';status:'active'|'ended';startsAt:number;expiresAt:number;cancelAtPeriodEnd:boolean};
export type MembershipSummary={launched:boolean;account:boolean;membership:MembershipRecord|null;status:'none'|'active'|'expired'|'inactive';usedRooms:number;roomLimit:number;canCreate:boolean};
// The web build has no paid rooms; the mini program owns private tables.
export const MEMBERSHIP_REQUIRED = '网页版暂不支持私人房间，请创建公开房间。';
export function requiresRoomMembership(visibility: unknown) {
  // Legacy anonymous creation also creates an invite room and must not bypass the gate.
  return visibility === undefined || visibility === 'private';
}
export function membershipStatus(record?:MembershipRecord|null,now=Date.now()):MembershipSummary['status']{
  if(!record)return 'none';
  if(!Number.isFinite(record.startsAt)||!Number.isFinite(record.expiresAt)||record.plan!=='puzzle')return 'inactive';
  if(record.expiresAt<=now)return 'expired';
  return record.status==='active'&&record.startsAt<=now?'active':'inactive';
}
export function canCreateMemberRoom(record?:MembershipRecord|null,now=Date.now()) { return membershipStatus(record,now)==='active'; }
