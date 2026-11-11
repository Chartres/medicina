-- Na medicínu: lesson requests from premium members.
--
-- A member files a request in the app; a builder job (service role, bypasses RLS) picks it from
-- the queue, builds the lesson and moves `status` along until it is live.
--
-- Lives on the fleet's shared project, so everything here is new and prefixed `medicina_`.
-- Additive and re-runnable; touches nothing that belongs to another app. No begin/commit: apply
-- it as one transaction (psql -1, or one Management API query).
-- Members are added by hand (service role / SQL editor); no address is committed.
-- Proof of the rules below: supabase/tests/medicina_requests.test.sql.

-- ---------- members ----------
create table if not exists public.medicina_members (
  email text primary key check (email = lower(email)),
  tier text not null default 'premium' check (tier in ('premium')),
  added_at timestamptz not null default now()
);
comment on table public.medicina_members is 'Na medicínu: who may file lesson requests. Rows are added by hand; clients can only read their own.';
alter table public.medicina_members enable row level security;
revoke all on public.medicina_members from public, anon, authenticated;
grant select on public.medicina_members to authenticated;

-- ---------- requests ----------
create table if not exists public.medicina_requests (
  id uuid primary key default gen_random_uuid(),
  user_id uuid references auth.users (id) on delete set null default auth.uid(),
  requester text,                      -- label for requests made by the system or Pavol; null for app requests
  kind text not null default 'new' check (kind in ('new', 'revise')),
  lesson_slug text check (lesson_slug ~ '^[a-z0-9-]{3,40}$'),  -- revise: which lesson; new: filled in by the builder
  topic text not null check (char_length(topic) between 3 and 200),
  notes text not null default '' check (char_length(notes) <= 4000),
  attachments jsonb not null default '[]' check (jsonb_typeof(attachments) = 'array'),  -- storage object paths
  status text not null default 'queued' check (status in ('queued', 'building', 'checking', 'live', 'failed', 'rejected')),
  status_note text,
  result_url text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
comment on table public.medicina_requests is 'Na medicínu: lesson requests. Members insert (queued only); the builder (service role) owns every other change.';
create index if not exists medicina_requests_user_created on public.medicina_requests (user_id, created_at desc);
alter table public.medicina_requests enable row level security;

-- Clients may read, and may write only the columns a request is made of. Everything else
-- (user_id, status, status_note, result_url, requester, timestamps) takes its default.
revoke all on public.medicina_requests from public, anon, authenticated;
grant select on public.medicina_requests to authenticated;
grant insert (id, kind, lesson_slug, topic, notes, attachments) on public.medicina_requests to authenticated;

create or replace function public.medicina_requests_touch() returns trigger
language plpgsql set search_path = '' as $$
begin
  new.updated_at := now();
  return new;
end $$;
revoke all on function public.medicina_requests_touch() from public, anon, authenticated;
drop trigger if exists medicina_requests_touch on public.medicina_requests;
create trigger medicina_requests_touch before update on public.medicina_requests
  for each row execute function public.medicina_requests_touch();

-- ---------- checks used by the policies ----------
-- security definer + empty search_path: the policies stay one readable line each, and a caller
-- cannot change what the checks see.

-- Is the caller's confirmed e-mail on the member list? Read from auth.users, not from the token:
-- an address a sign-in provider passed on without verifying it must not make anyone a member.
create or replace function public.medicina_is_member() returns boolean
language sql stable security definer set search_path = '' as $$
  select exists (
    select 1 from auth.users u join public.medicina_members m on m.email = lower(u.email)
    where u.id = auth.uid() and u.email_confirmed_at is not null and not u.is_sso_user);
$$;

-- Has the caller filed fewer than 3 requests in the last 24 hours? Volatile on purpose: it sees
-- rows inserted earlier in the same statement, so a multi-row insert cannot pass the cap. The
-- advisory lock makes parallel requests from one user wait for each other.
create or replace function public.medicina_under_daily_cap() returns boolean
language plpgsql volatile security definer set search_path = '' as $$
begin
  if auth.uid() is null then return false; end if;
  perform pg_advisory_xact_lock(hashtextextended('medicina_requests:' || auth.uid()::text, 0));
  return (select count(*) from public.medicina_requests r
          where r.user_id = auth.uid() and r.created_at > now() - interval '24 hours') < 3;
end $$;

-- Are the attachments at most 8 paths of the shape <uid>/<request id>/<0-7>.jpg? The builder
-- reads these with the service role, so a request must not be able to name another user's file.
create or replace function public.medicina_attachments_ok(a jsonb, uid uuid, req uuid) returns boolean
language sql immutable set search_path = '' as $$
  select case
    when jsonb_typeof(a) <> 'array' or jsonb_array_length(a) > 8 then false
    else not exists (
      select 1 from jsonb_array_elements(a) e
      where jsonb_typeof(e) <> 'string' or (e #>> '{}') !~ ('^' || uid::text || '/' || req::text || '/[0-7]\.jpg$'))
  end;
$$;

-- Has the caller uploaded fewer than 40 files in the last 24 hours? (3 requests x 8 pages, plus retries.)
-- No lock here: parallel uploads can overshoot by a few files, which costs nothing that matters.
create or replace function public.medicina_uploads_ok() returns boolean
language sql stable security definer set search_path = '' as $$
  select count(*) < 40 from storage.objects o
  where o.bucket_id = 'medicina-requests' and o.name like auth.uid()::text || '/%'
    and o.created_at > now() - interval '24 hours';
$$;

revoke all on function public.medicina_is_member() from public, anon;
revoke all on function public.medicina_under_daily_cap() from public, anon;
revoke all on function public.medicina_attachments_ok(jsonb, uuid, uuid) from public, anon;
revoke all on function public.medicina_uploads_ok() from public, anon;
grant execute on function public.medicina_is_member() to authenticated, service_role;
grant execute on function public.medicina_under_daily_cap() to authenticated, service_role;
grant execute on function public.medicina_attachments_ok(jsonb, uuid, uuid) to authenticated, service_role;
grant execute on function public.medicina_uploads_ok() to authenticated, service_role;

-- ---------- policies ----------
-- (select ...) around a check that is the same for every row runs it once per statement.
drop policy if exists medicina_members_select_own on public.medicina_members;
create policy medicina_members_select_own on public.medicina_members
  for select to authenticated
  using (email = lower(auth.jwt() ->> 'email') and (select public.medicina_is_member()));

drop policy if exists medicina_requests_select_own on public.medicina_requests;
create policy medicina_requests_select_own on public.medicina_requests
  for select to authenticated
  using (user_id = (select auth.uid()));

-- No update or delete policy: a filed request belongs to the builder.
drop policy if exists medicina_requests_insert_member on public.medicina_requests;
create policy medicina_requests_insert_member on public.medicina_requests
  for insert to authenticated
  with check (
    user_id = auth.uid()
    and status = 'queued' and status_note is null and result_url is null and requester is null
    and created_at = now() and updated_at = now()
    and ((kind = 'revise' and lesson_slug is not null) or (kind = 'new' and lesson_slug is null))
    and public.medicina_attachments_ok(attachments, user_id, id)
    and public.medicina_is_member()
    and public.medicina_under_daily_cap()
  );

-- ---------- workbook photos ----------
-- Private bucket. Object path: <auth.uid()>/<request id>/<n>.jpg. The storage API enforces the
-- size limit and the image types; the policies below enforce who and where.
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('medicina-requests', 'medicina-requests', false, 6291456, array['image/jpeg', 'image/png', 'image/webp'])
on conflict (id) do nothing;

drop policy if exists medicina_requests_objects_insert_own on storage.objects;
create policy medicina_requests_objects_insert_own on storage.objects
  for insert to authenticated
  with check (
    bucket_id = 'medicina-requests'
    and name ~ ('^' || auth.uid()::text || '/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/[0-7]\.jpg$')
    and public.medicina_is_member()
    and public.medicina_uploads_ok()
  );

drop policy if exists medicina_requests_objects_select_own on storage.objects;
create policy medicina_requests_objects_select_own on storage.objects
  for select to authenticated
  using (
    bucket_id = 'medicina-requests'
    and (storage.foldername(name))[1] = (select auth.uid())::text
    and (select public.medicina_is_member())
  );
