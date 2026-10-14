'use client';
import {managedCursorUrl,type ManagedCursorArt} from '@/lib/managed-decoration-art';
export default function ManagedCursor({art}:{art:ManagedCursorArt}){
 return <img src={managedCursorUrl(art)} alt="" width={32} height={32} style={{width:32,height:32,transform:'translate(-16px,-16px)',position:'absolute'}}/>;
}
