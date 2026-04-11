# Zeptra

Role-based employee expense management system built with React and Supabase.

## Local setup

1. Copy `.env.example` to `.env.local`.
2. Set:
   - `VITE_SUPABASE_URL`
   - `VITE_SUPABASE_ANON_KEY`
   - `VITE_INVITE_REDIRECT_TO` (optional, defaults to current app origin + `/login`)
3. Run `npm install` and `npm run dev`.
4. Sign in with an existing admin account.

## Organization onboarding (owner signup)

Use `/create-organization` to create the first organization owner account.

The form calls the `bootstrap-organization` Supabase Edge Function, which:
- creates the org creator auth user
- sets creator profile
- replaces default role and assigns `admin` (owner-level access)
- lets the app sign in immediately and open `/app`

## Admin-only user onboarding (invite flow)

Public sign-up is disabled in the app UI. New users must be invited by an admin from **User Management**.

When an admin creates a user, the app calls the `invite-user` Supabase Edge Function, which:
- sends activation email via `auth.admin.inviteUserByEmail`
- sets profile fields (name, manager, tag)
- assigns selected role

### Deploy required edge function

1. Ensure you are logged into Supabase CLI and linked to your project.
2. Deploy function:
   - `supabase functions deploy bootstrap-organization`
   - `supabase functions deploy invite-user`
3. (Recommended) Disable self signups in Supabase Dashboard:
   - Authentication -> Providers -> Email -> disable "Enable email signups"

### Bootstrap first admin

If no admin exists yet, assign one manually:

```sql
insert into public.user_roles (user_id, role)
values ('<USER_ID>', 'admin')
on conflict (user_id, role) do nothing;
```
