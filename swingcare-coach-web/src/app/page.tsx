import { redirect } from 'next/navigation';

import { MissingEnvNotice } from '@/components/MissingEnvNotice';
import { getCoachSession, getServerSupabase } from '@/lib/coachAuth';

export default async function HomePage() {
  const supabase = await getServerSupabase();
  if (!supabase) {
    return <MissingEnvNotice />;
  }
  const session = await getCoachSession();
  redirect(session ? '/coach/requests' : '/coach/login');
}
