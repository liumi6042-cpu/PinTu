'use client';
import { useLanguage } from './language-switch';
export default function ServiceFooter(){const en=useLanguage()==='en';return <footer className="service-footer"><a href="/help">{en?'Help & saves':'帮助与存档'}</a><a href="/account/security">{en?'Account & security':'账号与安全'}</a><a href="/privacy">{en?'Privacy':'隐私说明'}</a><a href="/terms">{en?'Terms':'服务条款'}</a><a href="/feedback">{en?'Contact & feedback':'联系与反馈'}</a></footer>;}
