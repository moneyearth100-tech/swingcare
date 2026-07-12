import Link from 'next/link';
import { redirect } from 'next/navigation';

import { signOutAction } from '@/app/coach/actions';
import { requireCoachSession } from '@/lib/coachAuth';
import { createClient } from '@/lib/supabase/server';

export async function CoachShell({
  children,
  title,
}: {
  children: React.ReactNode;
  title: string;
}) {
  const supabase = await createClient();
  if (!supabase) {
    redirect('/coach/login');
  }
  const session = await requireCoachSession(supabase);
  if (!session) {
    redirect('/coach/login');
  }

  return (
    <div className="shell">
      <header className="topbar">
        <div className="topbar-left">
          <Link href="/coach/requests" className="brand-link">
            SwingCare Coach
          </Link>
          <span className="topbar-title">{title}</span>
        </div>
        <div className="topbar-right">
          <span className="muted">{session.coachName}</span>
          <form action={signOutAction}>
            <button type="submit" className="btn ghost">
              로그아웃
            </button>
          </form>
        </div>
      </header>
      <main className="content">{children}</main>
    </div>
  );
}
