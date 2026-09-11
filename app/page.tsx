import HomeExperience from './home-experience';
import { jsonLd, pageMetadata, SITE_NAME, SITE_URL } from '@/lib/seo';
export const metadata = pageMetadata('/');
export default function Home() {
 return <><script type="application/ld+json" dangerouslySetInnerHTML={{__html: jsonLd({ '@context': 'https://schema.org', '@type': 'WebSite', '@id': SITE_URL + '/', name: SITE_NAME, alternateName: '一起拼图', url: SITE_URL + '/' })}}/><HomeExperience/></>;
}
