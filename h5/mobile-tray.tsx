import { useEffect, useRef, useState } from 'react';
import { ChevronLeft, ChevronRight, X } from 'lucide-react';
import type { PuzzleState } from '../lib/puzzle-engine';
import type { PuzzleTable } from '../lib/puzzle-table';
import { drawPiecePicture } from '../lib/puzzle-picture';

// This local finder changes only the camera and selected outline, never room state.
export function MobileTray({state,getTable,onClose,edges=false}:{state:PuzzleState;getTable:()=>PuzzleTable|null;onClose:()=>void;edges?:boolean}) {
 const [page,setPage]=useState(0),[selected,setSelected]=useState<number|null>(null),[notice,setNotice]=useState('');
 const table=getTable();
 const groups=state.groups.filter(group=>!group.locked&&(!edges||group.pieces.some(id=>table?.pieces[id]?.border)));
 const pages=Math.max(1,Math.ceil(groups.length/24)),current=Math.min(page,pages-1);
 const visible=groups.slice(current*24,current*24+24);
 return <aside className="mobile-piece-tray" aria-label="可选碎片托盘">
  <div className="mobile-tray-heading"><strong>碎片托盘 <small>{groups.length}组</small></strong><span>点选定位</span><button type="button" onClick={onClose} aria-label="关闭碎片托盘"><X size={18}/></button></div>
  <div className="mobile-tray-scroller">{visible.map(group=><button type="button" key={group.id} className={selected===group.id?'is-selected':''} aria-label={`定位拼块${group.pieces[0]+1}${group.pieces.length>1?'，组合'+group.pieces.length+'片':''}`} onClick={()=>{const engine=getTable();if(engine?.focusMobilePiece(group.pieces[0],210)){setSelected(group.id);setNotice('已定位，直接拖动画布中的拼块');}else setNotice('这块刚被拼好，请选择其他碎片');}}><PieceThumbnail table={table} pieceId={group.pieces[0]}/>{group.pieces.length>1&&<small>×{group.pieces.length}</small>}</button>)}{!groups.length&&<p>所有拼块都已归位</p>}</div>
  <div className="mobile-tray-pagination"><span role="status">{notice||'画布里的散片会保持原位'}</span><button type="button" aria-label="上一组碎片" disabled={current===0} onClick={()=>setPage(current-1)}><ChevronLeft size={16}/></button><output>{current+1}/{pages}</output><button type="button" aria-label="下一组碎片" disabled={current>=pages-1} onClick={()=>setPage(current+1)}><ChevronRight size={16}/></button></div>
 </aside>;
}

function PieceThumbnail({table,pieceId}:{table:PuzzleTable|null;pieceId:number}) {
 const canvas=useRef<HTMLCanvasElement>(null);
 useEffect(()=>{const target=canvas.current,piece=table?.pieces[pieceId];if(!target||!table||!piece)return;const context=target.getContext('2d');if(!context)return;const size=112,w=table.board.width/table.state.cols,h=table.board.height/table.state.rows,pad=Math.min(w,h)*.28,scale=(size-8)/Math.max(w+pad*2,h+pad*2);target.width=size;target.height=size;context.clearRect(0,0,size,size);context.translate((size-w*scale)/2,(size-h*scale)/2);context.scale(scale,scale);context.save();context.clip(table.paths[pieceId]);drawPiecePicture(context,table.picture,piece,table.state.cols,table.state.rows,table.board.width,table.board.height);context.restore();context.strokeStyle='#895c5b';context.lineWidth=1.2/scale;context.stroke(table.paths[pieceId]);},[table,pieceId]);
 return <canvas ref={canvas} aria-hidden="true"/>;
}
