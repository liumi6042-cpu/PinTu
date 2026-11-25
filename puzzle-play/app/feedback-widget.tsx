'use client';
import {useLanguage} from './language-switch';
import {usePathname} from 'next/navigation';
import {hasChineseAddress,isChinesePath} from '@/lib/site-paths';
// A paired address speaks its own language; anything else follows the visitor.
const pageLanguage=(pathname:string,detected:'zh'|'en')=>hasChineseAddress(pathname)?(isChinesePath(pathname)?'zh':'en'):detected;
import FeedbackSurface,{FeedbackButton} from '@/components/feedback/surface';
export default function FeedbackWidget(){const detected=useLanguage(),language=pageLanguage(usePathname()||'',detected);return <FeedbackSurface language={language} theme="puzzle"/>;}
export function FeedbackPage(){const detected=useLanguage(),language=pageLanguage(usePathname()||'',detected);return <FeedbackSurface language={language} theme="puzzle" standalone/>;}
export function ReportProblem({context={},className='text-button'}:{context?:Record<string,string|number>;className?:string}){const detected=useLanguage(),language=pageLanguage(usePathname()||'',detected);return <FeedbackButton language={language} context={context} className={className}/>;}
