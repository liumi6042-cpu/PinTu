import {redirect} from 'next/navigation';
// The uploader lives inside the help page now; keep the old address working.
export const metadata = {robots:{index:false,follow:false}};
export default function Page(){redirect('/zh/help#upload');}
