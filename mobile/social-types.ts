/** Public mobile social DTOs. Player codes are stable across room visits. */
export type SocialPlayer={code:string;name:string;level:number;online:boolean;lastSeenAt:number;room?:{id:string;title:string;pieces:number;visibility?:'public'|'private'|'solo'}|null};
export type SocialRequest=SocialPlayer&{createdAt:number};
export type SocialMessage={id:number;kind:'text'|'room-invite';text?:string;roomId?:string;title?:string;pieces?:number;visibility?:'public'|'private'|'solo';inviteCode?:string;from:string;to:string;mine:boolean;sentAt:number};
export type SocialSnapshot={self:SocialPlayer;friends:SocialPlayer[];requests:{incoming:SocialRequest[];outgoing:SocialRequest[]};conversations:Array<{peer:SocialPlayer;lastMessage:SocialMessage;unread:number}>;blocked:SocialPlayer[];unread:number;serverTime:number};
export type SocialRelationship='self'|'friend'|'incoming'|'outgoing'|'blocked'|'none';
export type SocialSearchResult={player:SocialPlayer;relationship:SocialRelationship};
export type SocialConversation={peer:SocialPlayer;messages:SocialMessage[];hasMore:boolean;unread:number;serverTime:number};
export type SocialReportReason='harassment'|'advertising'|'inappropriate'|'other';
export type SocialRoomContext={id:string;title:string;pieces:number;visibility?:'public'|'private'|'solo';inviteCode?:string;authorization:string;members:Array<{id?:string;code?:string;name:string;level?:number;online?:boolean}>};
