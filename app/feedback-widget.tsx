'use client';
import {useLanguage} from './language-switch';
import {usePathname} from 'next/navigation';
import {isChinesePath} from '@/lib/site-paths';
import FeedbackSurface,{FeedbackButton} from '@/components/feedback/surface';
export default function FeedbackWidget(){const detected=useLanguage(),language=isChinesePath(usePathname()||'')?'zh':detected;return <FeedbackSurface language={language} theme="puzzle"/>;}
export function FeedbackPage(){const detected=useLanguage(),language=isChinesePath(usePathname()||'')?'zh':detected;return <FeedbackSurface language={language} theme="puzzle" standalone/>;}
export function ReportProblem({context={},className='text-button'}:{context?:Record<string,string|number>;className?:string}){const detected=useLanguage(),language=isChinesePath(usePathname()||'')?'zh':detected;return <FeedbackButton language={language} context={context} className={className}/>;}
