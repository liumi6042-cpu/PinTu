import type {RoomSnapshot} from './room-engine';

export type TapPreviewDescriptor={version:1;testOnly:boolean;epoch:string;serial:number;channelId:string|null;peers:Array<{clientId:string;tapPlayerId:string;playerId:string;ready:boolean}>};
export type MovePreview={playerId:string;groupId:number;dx:number;dy:number;leaseId:string;receivedAt:number};
export type RoomPreview={
 readonly connected:boolean;
 sendMove(groupId:number,dx:number,dy:number):boolean;
 clearMove(groupId:number):void;
 observe(snapshot:RoomSnapshot):void;
 subscribeMoves(listener:(moves:MovePreview[])=>void):()=>void;
};
