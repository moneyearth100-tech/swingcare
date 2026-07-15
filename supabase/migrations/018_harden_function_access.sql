-- Harden function resolution and prevent direct RPC access to trigger-only code.
-- Signed-in anonymous users retain the authenticated role and existing RLS access.

begin;

alter function public.coaching_requests_coach_update_guard()
  set search_path = public;

alter function public.users_prevent_role_self_escalation()
  set search_path = public;

alter function public.handle_new_user()
  set search_path = public;

revoke execute on function public.handle_new_user()
  from public, anon, authenticated, service_role;
grant execute on function public.handle_new_user()
  to postgres, supabase_auth_admin;

alter function public.get_challenge_participant_counts()
  set search_path = public;
revoke execute on function public.get_challenge_participant_counts()
  from public, anon;
grant execute on function public.get_challenge_participant_counts()
  to authenticated;

alter function public.get_global_leaderboard(integer)
  set search_path = public;
revoke execute on function public.get_global_leaderboard(integer)
  from public, anon;
grant execute on function public.get_global_leaderboard(integer)
  to authenticated;

commit;
