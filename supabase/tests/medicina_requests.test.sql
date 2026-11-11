-- Proof of the rules in supabase/migrations/20261111_medicina_requests.sql.
--
-- One DO block = one statement = one transaction. It makes three throwaway users, runs every
-- check as the role and JWT a real client would have, and ALWAYS ends by raising an exception
-- that carries the results. The exception rolls everything back, so no row, user or file is left
-- behind whether the checks pass, fail or the connection drops half way.
--
-- Run: node supabase/tests/run.mjs   (exits non-zero on a failed expectation)
-- or paste into psql / the SQL editor and read the JSON after MEDICINA_REQUESTS_TEST in the error.
do $test$
declare
  a uuid := gen_random_uuid();  -- member
  b uuid := gen_random_uuid();  -- another member
  n uuid := gen_random_uuid();  -- signed in, not a member
  u uuid := gen_random_uuid();  -- on the member list, but the address was never confirmed
  ca text; cb text; cn text; cu text;  -- their JWT claims
  r1 uuid := gen_random_uuid(); r2 uuid := gen_random_uuid();
  rls constant text := 'row-level security';
  denied constant text := 'permission denied';
  results jsonb;
begin
  insert into auth.users (id, instance_id, aud, role, email, email_confirmed_at, created_at, updated_at)
  select x, '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', x::text || '@medicina-test.invalid', case when x <> u then now() end, now(), now()
  from unnest(array[a, b, n, u]) x;
  insert into public.medicina_members (email) select x::text || '@medicina-test.invalid' from unnest(array[a, b, u]) x;
  ca := json_build_object('sub', a, 'email', upper(a::text) || '@medicina-test.invalid', 'role', 'authenticated')::text;  -- upper: the match is case-blind
  cb := json_build_object('sub', b, 'email', b::text || '@medicina-test.invalid', 'role', 'authenticated')::text;
  cn := json_build_object('sub', n, 'email', n::text || '@medicina-test.invalid', 'role', 'authenticated')::text;
  cu := json_build_object('sub', u, 'email', u::text || '@medicina-test.invalid', 'role', 'authenticated')::text;

  create temp table medicina_t (i serial, label text, want text, got text) on commit drop;

  -- Run one statement as a role with JWT claims. Returns 'ok <rows>' or '<sqlstate> <message>'.
  create function pg_temp.medicina_try(p_role text, p_claims text, p_sql text) returns text language plpgsql as $f$
  declare cnt bigint; msg text;
  begin
    begin
      perform set_config('request.jwt.claims', p_claims, true);
      execute format('set local role %I', p_role);
      execute p_sql;
      get diagnostics cnt = row_count;
      msg := 'ok ' || cnt;
    exception when others then
      msg := sqlstate || ' ' || sqlerrm;
    end;
    reset role;
    perform set_config('request.jwt.claims', '', true);
    return msg;
  end $f$;
  -- Record one expectation: `want` is a regular expression the outcome must match.
  create function pg_temp.medicina_expect(p_label text, p_role text, p_claims text, p_sql text, p_want text) returns void language plpgsql as $f$
  begin
    insert into medicina_t (label, want, got) values (p_label, p_want, pg_temp.medicina_try(p_role, p_claims, p_sql));
  end $f$;

  -- ---- anon can do nothing ----
  perform pg_temp.medicina_expect('anon cannot read members', 'anon', '{"role":"anon"}', 'select * from public.medicina_members', denied);
  perform pg_temp.medicina_expect('anon cannot read requests', 'anon', '{"role":"anon"}', 'select * from public.medicina_requests', denied);
  perform pg_temp.medicina_expect('anon cannot insert a request', 'anon', '{"role":"anon"}', $$insert into public.medicina_requests (topic) values ('Mitóza')$$, denied);
  perform pg_temp.medicina_expect('anon cannot call the member check', 'anon', '{"role":"anon"}', 'select public.medicina_is_member()', denied);
  perform pg_temp.medicina_expect('anon cannot upload', 'anon', '{"role":"anon"}',
    format($$insert into storage.objects (bucket_id, name) values ('medicina-requests', '%s/%s/0.jpg')$$, a, r1), rls);

  -- ---- signed in, not a member ----
  perform pg_temp.medicina_expect('non-member sees no member rows', 'authenticated', cn, 'select * from public.medicina_members', '^ok 0$');
  perform pg_temp.medicina_expect('non-member cannot insert a request', 'authenticated', cn, $$insert into public.medicina_requests (topic) values ('Mitóza')$$, rls);
  perform pg_temp.medicina_expect('non-member cannot upload into own folder', 'authenticated', cn,
    format($$insert into storage.objects (bucket_id, name) values ('medicina-requests', '%s/%s/0.jpg')$$, n, r1), rls);

  -- ---- on the list, but the address is not confirmed (a provider that does not verify e-mails) ----
  perform pg_temp.medicina_expect('unconfirmed address: no member row', 'authenticated', cu, 'select * from public.medicina_members', '^ok 0$');
  perform pg_temp.medicina_expect('unconfirmed address: cannot insert a request', 'authenticated', cu, $$insert into public.medicina_requests (topic) values ('Mitóza')$$, rls);
  perform pg_temp.medicina_expect('unconfirmed address: cannot upload', 'authenticated', cu,
    format($$insert into storage.objects (bucket_id, name) values ('medicina-requests', '%s/%s/0.jpg')$$, u, r1), rls);
  -- a token that claims a member's address for another user is not enough either
  perform pg_temp.medicina_expect('a borrowed e-mail claim: cannot insert a request', 'authenticated',
    json_build_object('sub', n, 'email', a::text || '@medicina-test.invalid', 'role', 'authenticated')::text,
    $$insert into public.medicina_requests (topic) values ('Mitóza')$$, rls);

  -- ---- member ----
  perform pg_temp.medicina_expect('member sees only the own member row', 'authenticated', ca, 'select * from public.medicina_members', '^ok 1$');
  perform pg_temp.medicina_expect('member can insert a request (1 of 3)', 'authenticated', ca, $$insert into public.medicina_requests (topic, notes) values ('Mitóza', 'fáze a kontrolní body')$$, '^ok 1$');
  -- column grants: the columns the builder owns cannot even be named
  perform pg_temp.medicina_expect('member cannot set status', 'authenticated', ca, $$insert into public.medicina_requests (topic, status) values ('Mitóza', 'live')$$, denied);
  perform pg_temp.medicina_expect('member cannot set status_note', 'authenticated', ca, $$insert into public.medicina_requests (topic, status_note) values ('Mitóza', 'x')$$, denied);
  perform pg_temp.medicina_expect('member cannot set result_url', 'authenticated', ca, $$insert into public.medicina_requests (topic, result_url) values ('Mitóza', 'https://example.org')$$, denied);
  perform pg_temp.medicina_expect('member cannot set requester', 'authenticated', ca, $$insert into public.medicina_requests (topic, requester) values ('Mitóza', 'system')$$, denied);
  perform pg_temp.medicina_expect('member cannot set user_id', 'authenticated', ca, format($$insert into public.medicina_requests (topic, user_id) values ('Mitóza', '%s')$$, b), denied);
  perform pg_temp.medicina_expect('member cannot backdate created_at', 'authenticated', ca, $$insert into public.medicina_requests (topic, created_at) values ('Mitóza', now() - interval '2 days')$$, denied);
  perform pg_temp.medicina_expect('member cannot update a request', 'authenticated', ca, $$update public.medicina_requests set status = 'live'$$, denied);
  perform pg_temp.medicina_expect('member cannot delete a request', 'authenticated', ca, 'delete from public.medicina_requests', denied);
  -- shape
  perform pg_temp.medicina_expect('topic shorter than 3 is refused', 'authenticated', ca, $$insert into public.medicina_requests (topic) values ('ab')$$, '^23514');
  perform pg_temp.medicina_expect('a bad lesson_slug is refused', 'authenticated', ca, $$insert into public.medicina_requests (topic, kind, lesson_slug) values ('Mitóza', 'revise', 'Dělení buňky')$$, '^23514');
  perform pg_temp.medicina_expect('revise needs a lesson_slug', 'authenticated', ca, $$insert into public.medicina_requests (topic, kind) values ('Mitóza', 'revise')$$, rls);
  perform pg_temp.medicina_expect('new must not carry a lesson_slug', 'authenticated', ca, $$insert into public.medicina_requests (topic, kind, lesson_slug) values ('Mitóza', 'new', 'deleni-bunky')$$, rls);
  perform pg_temp.medicina_expect('attachments cannot name another user''s file', 'authenticated', ca,
    format($$insert into public.medicina_requests (id, topic, attachments) values ('%s', 'Mitóza', '["%s/%s/0.jpg"]')$$, r1, b, r1), rls);
  perform pg_temp.medicina_expect('attachments cannot name another request''s file', 'authenticated', ca,
    format($$insert into public.medicina_requests (id, topic, attachments) values ('%s', 'Mitóza', '["%s/%s/0.jpg"]')$$, r1, a, r2), rls);
  perform pg_temp.medicina_expect('more than 8 attachments are refused', 'authenticated', ca,
    format($$insert into public.medicina_requests (id, topic, attachments) select '%s', 'Mitóza', jsonb_agg('%s/%s/0.jpg'::text) from generate_series(1, 9)$$, r1, a, r1), rls);
  perform pg_temp.medicina_expect('attachments must be an array', 'authenticated', ca,
    format($$insert into public.medicina_requests (id, topic, attachments) values ('%s', 'Mitóza', '"x"')$$, r1), '^23514|' || rls);
  perform pg_temp.medicina_expect('member can revise a lesson (2 of 3)', 'authenticated', ca, $$insert into public.medicina_requests (topic, kind, lesson_slug) values ('Chybí crossing-over', 'revise', 'deleni-bunky')$$, '^ok 1$');
  perform pg_temp.medicina_expect('member can attach own files (3 of 3)', 'authenticated', ca,
    format($$insert into public.medicina_requests (id, topic, attachments) values ('%s', 'Meióza', '["%s/%s/0.jpg","%s/%s/7.jpg"]')$$, r1, a, r1, a, r1), '^ok 1$');
  perform pg_temp.medicina_expect('the 4th request within 24 h is refused', 'authenticated', ca, $$insert into public.medicina_requests (topic) values ('Čtvrtá')$$, rls);
  perform pg_temp.medicina_expect('member reads the own 3 requests', 'authenticated', ca, 'select * from public.medicina_requests', '^ok 3$');
  perform pg_temp.medicina_expect('another member reads none of them', 'authenticated', cb, 'select * from public.medicina_requests', '^ok 0$');
  perform pg_temp.medicina_expect('a non-member reads none of them', 'authenticated', cn, 'select * from public.medicina_requests', '^ok 0$');
  -- the cap cannot be passed with one multi-row insert
  perform pg_temp.medicina_expect('4 rows in one insert are refused', 'authenticated', cb, $$insert into public.medicina_requests (topic) select 'Lekce ' || g from generate_series(1, 4) g$$, rls);
  perform pg_temp.medicina_expect('3 rows in one insert pass', 'authenticated', cb, $$insert into public.medicina_requests (topic) select 'Lekce ' || g from generate_series(1, 3) g$$, '^ok 3$');
  perform pg_temp.medicina_expect('and then the next one is refused', 'authenticated', cb, $$insert into public.medicina_requests (topic) values ('Čtvrtá')$$, rls);
  -- the cap is a 24 h window: age A's requests (as the builder could) and A may ask again
  update public.medicina_requests set created_at = now() - interval '25 hours' where user_id = a;
  perform pg_temp.medicina_expect('after 24 h the member can ask again', 'authenticated', ca, $$insert into public.medicina_requests (topic) values ('Další den')$$, '^ok 1$');
  -- (inside one transaction now() does not move, so the trigger is shown by it overriding a stale value)
  update public.medicina_requests set updated_at = now() - interval '3 days' where id = r1;
  insert into medicina_t (label, want, got)
    select 'an update always stamps updated_at', '^true$', (updated_at = now())::text from public.medicina_requests where id = r1;

  -- ---- the policy alone, without the column grants ----
  -- If someone later grants plain INSERT on the table, the policy must still hold every rule.
  grant insert on public.medicina_requests to authenticated;
  perform pg_temp.medicina_expect('policy: status must be queued', 'authenticated', ca, $$insert into public.medicina_requests (topic, status) values ('Mitóza', 'live')$$, rls);
  perform pg_temp.medicina_expect('policy: status_note must be null', 'authenticated', ca, $$insert into public.medicina_requests (topic, status_note) values ('Mitóza', 'x')$$, rls);
  perform pg_temp.medicina_expect('policy: result_url must be null', 'authenticated', ca, $$insert into public.medicina_requests (topic, result_url) values ('Mitóza', 'https://example.org')$$, rls);
  perform pg_temp.medicina_expect('policy: requester must be null', 'authenticated', ca, $$insert into public.medicina_requests (topic, requester) values ('Mitóza', 'system')$$, rls);
  perform pg_temp.medicina_expect('policy: user_id must be the caller', 'authenticated', ca, format($$insert into public.medicina_requests (topic, user_id) values ('Mitóza', '%s')$$, b), rls);
  perform pg_temp.medicina_expect('policy: user_id cannot be null', 'authenticated', ca, $$insert into public.medicina_requests (topic, user_id) values ('Mitóza', null)$$, rls);
  perform pg_temp.medicina_expect('policy: created_at cannot be backdated', 'authenticated', ca, $$insert into public.medicina_requests (topic, created_at) values ('Mitóza', now() - interval '2 days')$$, rls);
  perform pg_temp.medicina_expect('policy: a plain request still passes (2 of 3 today)', 'authenticated', ca, $$insert into public.medicina_requests (topic) values ('Mitóza')$$, '^ok 1$');

  -- ---- storage ----
  insert into medicina_t (label, want, got)
    select 'bucket is private, 6 MB, images only', '^true$',
      coalesce(bool_and(not public and file_size_limit = 6291456 and allowed_mime_types = array['image/jpeg', 'image/png', 'image/webp']), false)::text
    from storage.buckets where id = 'medicina-requests';
  perform pg_temp.medicina_expect('member can upload into own folder', 'authenticated', ca,
    format($$insert into storage.objects (bucket_id, name) values ('medicina-requests', '%s/%s/0.jpg')$$, a, r1), '^ok 1$');
  perform pg_temp.medicina_expect('member cannot upload into another folder', 'authenticated', ca,
    format($$insert into storage.objects (bucket_id, name) values ('medicina-requests', '%s/%s/0.jpg')$$, b, r1), rls);
  perform pg_temp.medicina_expect('member cannot upload outside <uid>/<request id>/', 'authenticated', ca,
    format($$insert into storage.objects (bucket_id, name) values ('medicina-requests', '%s/0.jpg')$$, a), rls);
  perform pg_temp.medicina_expect('a 9th file (8.jpg) is refused', 'authenticated', ca,
    format($$insert into storage.objects (bucket_id, name) values ('medicina-requests', '%s/%s/8.jpg')$$, a, r1), rls);
  perform pg_temp.medicina_expect('another file name is refused', 'authenticated', ca,
    format($$insert into storage.objects (bucket_id, name) values ('medicina-requests', '%s/%s/evil.html')$$, a, r1), rls);
  perform pg_temp.medicina_expect('member cannot write into another bucket', 'authenticated', ca,
    format($$insert into storage.objects (bucket_id, name) values ('medicina-test-no-such-bucket', '%s/%s/0.jpg')$$, a, r1), rls || '|^23503');
  perform pg_temp.medicina_expect('member reads the own file', 'authenticated', ca, $$select * from storage.objects where bucket_id = 'medicina-requests'$$, '^ok 1$');
  perform pg_temp.medicina_expect('another member does not see it', 'authenticated', cb, $$select * from storage.objects where bucket_id = 'medicina-requests'$$, '^ok 0$');
  perform pg_temp.medicina_expect('a non-member does not see it', 'authenticated', cn, $$select * from storage.objects where bucket_id = 'medicina-requests'$$, '^ok 0$');
  perform pg_temp.medicina_expect('anon does not see it', 'anon', '{"role":"anon"}', $$select * from storage.objects where bucket_id = 'medicina-requests'$$, '^ok 0$');
  perform pg_temp.medicina_expect('member cannot overwrite a file', 'authenticated', ca, $$update storage.objects set name = name || 'x' where bucket_id = 'medicina-requests'$$, '^ok 0$');
  perform pg_temp.medicina_expect('member cannot delete a file', 'authenticated', ca, $$delete from storage.objects where bucket_id = 'medicina-requests'$$, '^ok 0$|^42501');
  perform pg_temp.medicina_expect('the file is still there', 'authenticated', ca, $$select * from storage.objects where bucket_id = 'medicina-requests'$$, '^ok 1$');
  -- upload cap: 40 files in 24 h
  insert into storage.objects (bucket_id, name) select 'medicina-requests', a::text || '/' || gen_random_uuid() || '/' || (g % 8) || '.jpg' from generate_series(1, 39) g;
  perform pg_temp.medicina_expect('the 41st upload within 24 h is refused', 'authenticated', ca,
    format($$insert into storage.objects (bucket_id, name) values ('medicina-requests', '%s/%s/1.jpg')$$, a, r1), rls);

  select jsonb_agg(jsonb_build_object('label', label, 'pass', got ~ want, 'want', want, 'got', left(got, 120)) order by i) into results from medicina_t;
  raise exception 'MEDICINA_REQUESTS_TEST %', results;
end $test$;
