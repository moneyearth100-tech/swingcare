import Link from 'next/link';
import { redirect } from 'next/navigation';

import { signOutAction } from '@/app/coach/actions';
import { getCoachSession, type CoachSession } from '@/lib/coachAuth';

export async function CoachShell({
  children,
  title,
  session: sessionProp,
}: {
  children: React.ReactNode;
  title: string;
  session?: CoachSession | null;
}) {
  const session = sessionProp ?? (await getCoachSession());
  if (!session) {
    redirect('/coach/login');
  }

  return (
    <div className="shell">
      <header className="topbar">
        <div className="topbar-left">
          <Link href="/coach/requests" className="brand-link" prefetch>
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
