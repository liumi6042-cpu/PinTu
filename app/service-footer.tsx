'use client';
import { usePathname } from 'next/navigation';
import { hasChineseAddress,isChinesePath } from '@/lib/site-paths';
import { useLanguage } from './language-switch';
// Help has a Chinese page, so the footer keeps a visitor on /zh; the other links
// have no Chinese copy and stay on their single shared address.
export default function ServiceFooter(){const pathname=usePathname()||'',zh=isChinesePath(pathname),en=hasChineseAddress(pathname)?!zh:useLanguage()==='en';return <footer className="service-footer"><a href={zh?'/zh/help':'/help'}>{en?'Help & saves':'帮助与存档'}</a><a href="/account/security">{en?'Account & security':'账号与安全'}</a><a href="/privacy">{en?'Privacy':'隐私说明'}</a><a href="/terms">{en?'Terms':'服务条款'}</a><a href="/feedback">{en?'Contact & feedback':'联系与反馈'}</a></footer>;}
