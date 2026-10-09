'use client';
import { Puzzle,BookOpen,Mountain,Sparkles,Leaf,Handshake,Sun } from 'lucide-react';
import { achievementById } from '@/lib/achievements';
import { t } from '@/lib/i18n';
const icons={puzzle:Puzzle,book:BookOpen,mountain:Mountain,sparkles:Sparkles,leaf:Leaf,hands:Handshake,sun:Sun};
export default function AchievementBadge({id,small=false}:{id:string;small?:boolean}){
  const badge=achievementById(id);if(!badge)return null;const Icon=icons[badge.icon];
  return <span className={'achievement-seal'+(small?' small':'')} title={t(badge.name)} aria-label={t(badge.name)}><Icon size={small?15:30} strokeWidth={1.5}/></span>;
}
