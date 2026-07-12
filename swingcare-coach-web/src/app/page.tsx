import { redirect } from 'next/navigation';

import { MissingEnvNotice } from '@/components/MissingEnvNotice';
import { requireCoachSession } from '@/lib/coachAuth';
import { createClient } from '@/lib/supabase/server';

export default async function HomePage() {
  const supabase = await createClient();
  if (!supabase) {
    return <MissingEnvNotice />;
  }
  const session = await requireCoachSession(supabase);
  redirect(session ? '/coach/requests' : '/coach/login');
}
