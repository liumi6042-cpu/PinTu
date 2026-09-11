'use client';
import {useLanguage} from './language-switch';
import FeedbackSurface,{FeedbackButton} from '@/components/feedback/surface';
export default function FeedbackWidget(){const language=useLanguage();return <FeedbackSurface language={language} theme="puzzle"/>;}
export function FeedbackPage(){const language=useLanguage();return <FeedbackSurface language={language} theme="puzzle" standalone/>;}
export function ReportProblem({context={},className='text-button'}:{context?:Record<string,string|number>;className?:string}){const language=useLanguage();return <FeedbackButton language={language} context={context} className={className}/>;}
