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

## AWS S3 Setup

The application uses AWS S3 via pre-signed URLs to handle receipt file uploads natively from the browser. To make this work, the `get-upload-url` edge function requires the following environment variables:

- `AWS_ACCESS_KEY_ID`: Your IAM user access key.
- `AWS_SECRET_ACCESS_KEY`: Your IAM user secret access key.
- `AWS_REGION`: The AWS region where your bucket is located (e.g., `us-east-1`).
- `AWS_S3_BUCKET`: The name of the S3 bucket to store uploaded receipts.

Ensure these secrets are set in your Supabase environment:
```bash
supabase secrets set AWS_ACCESS_KEY_ID=your_key \
                     AWS_SECRET_ACCESS_KEY=your_secret \
                     AWS_REGION=your_region \
                     AWS_S3_BUCKET=your_bucket
```
