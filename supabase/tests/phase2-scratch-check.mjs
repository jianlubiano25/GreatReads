// Scratch-database check for the Phase 2 migration + rollback. Never touches Supabase.
// Run: mkdir /tmp/pgtest && cd /tmp/pgtest && npm i @electric-sql/pglite && cp <repo>/supabase/tests/phase2-scratch-check.mjs t.mjs && REPO=<repo> node t.mjs   (expect: pass 20 fail 0)
import { PGlite } from '@electric-sql/pglite';
import fs from 'fs';
const db = new PGlite();
const mig = fs.readFileSync((process.env.REPO||'.')+'/supabase/migrations/20261027000002_catalog_provider_records.sql','utf8');
const rb = fs.readFileSync((process.env.REPO||'.')+'/supabase/rollbacks/20261027000002_catalog_provider_records.rollback.sql','utf8');
let pass=0, fail=0; const ok=(c,m)=>{ c?pass++:(fail++,console.log('FAIL',m)); };
const q = async (sql)=> (await db.query(sql)).rows;
const throws = async (sql)=>{ try{ await db.exec(sql); return false; }catch(e){ return true; } };
// stubs of what the migration depends on
await db.exec(`
create role anon; create role authenticated;
create schema if not exists auth; create function auth.uid() returns uuid language sql as $$ select nullif(current_setting('app.uid',true),'')::uuid $$;
create function public.catalog_set_updated_at() returns trigger language plpgsql as $$ begin new.updated_at = now(); return new; end $$;
create table public.catalog_works (id uuid primary key default gen_random_uuid(), canonical_title text);
create table public.catalog_editions (id uuid primary key default gen_random_uuid(), work_id uuid references public.catalog_works(id) on delete cascade);
create table public.catalog_admins (user_id uuid primary key);
create table public.catalog_metadata_candidates (id uuid primary key default gen_random_uuid(), work_id uuid references public.catalog_works(id) on delete cascade, field_name text, field_value jsonb, source_name text, status text default 'candidate');
grant all on public.catalog_works, public.catalog_editions, public.catalog_admins, public.catalog_metadata_candidates to authenticated;
insert into public.catalog_works(id,canonical_title) values ('00000000-0000-0000-0000-0000000000a1','Nettle & Bone');
insert into public.catalog_metadata_candidates(work_id,field_name,field_value,source_name) values ('00000000-0000-0000-0000-0000000000a1','year','2022','app');
insert into public.catalog_admins values ('00000000-0000-0000-0000-0000000000ad');
`);
const before = await q(`select count(*)::int n from catalog_works`) ;
await db.exec(mig); ok(true,'applies');
await db.exec(mig); ok(true,'applies twice (idempotent)');
// constraints
const W='00000000-0000-0000-0000-0000000000a1';
await db.exec(`insert into catalog_provider_records(provider,provider_record_id,payload_policy,payload,work_id) values ('openlibrary','OL1W','full','{"a":1}','${W}')`);
ok(await throws(`insert into catalog_provider_records(provider,provider_record_id,payload_policy,payload) values ('openlibrary','OL1W','full','{}')`),'duplicate provider+kind+id rejected');
ok(await throws(`insert into catalog_provider_records(provider,provider_record_id,payload_policy) values ('amazon','x','full')`),'unknown provider rejected');
ok(await throws(`insert into catalog_provider_records(provider,provider_record_id,payload_policy,payload) values ('google','v1','ids_only','{"x":1}')`),'ids_only with payload rejected');
ok(!(await throws(`insert into catalog_provider_records(provider,provider_record_id,payload_policy) values ('google','v1','ids_only')`)),'ids_only without payload ok');
ok(await throws(`insert into catalog_provider_records(provider,provider_record_id,payload_policy,match_confidence) values ('apple','1','trimmed',1.5)`),'confidence > 1 rejected');
// trigger
const t0 = (await q(`select updated_at from catalog_provider_records where provider_record_id='OL1W'`))[0].updated_at;
await new Promise(r=>setTimeout(r,15)); await db.exec(`update catalog_provider_records set match_status='matched' where provider_record_id='OL1W'`);
ok((await q(`select updated_at>created_at u from catalog_provider_records where provider_record_id='OL1W'`))[0].u,'updated_at trigger works');
// receipt survives deleting its work (set null, not cascade)
await db.exec(`insert into catalog_works(id,canonical_title) values ('00000000-0000-0000-0000-0000000000b2','Temp')`);
await db.exec(`insert into catalog_provider_records(provider,provider_record_id,payload_policy,work_id) values ('apple','999','trimmed','00000000-0000-0000-0000-0000000000b2')`);
await db.exec(`delete from catalog_works where id='00000000-0000-0000-0000-0000000000b2'`);
const r = await q(`select work_id from catalog_provider_records where provider_record_id='999'`); ok(r.length===1 && r[0].work_id===null,'record survives work delete, work_id becomes null');
// RLS: non-admin sees nothing and cannot write; admin can
await db.exec(`set role authenticated; select set_config('app.uid','00000000-0000-0000-0000-000000000111',false)`);
ok((await q(`select count(*)::int n from catalog_provider_records`))[0].n===0,'non-admin reads 0 rows');
ok(await throws(`insert into catalog_provider_records(provider,provider_record_id,payload_policy) values ('apple','5','trimmed')`),'non-admin insert blocked');
await db.exec(`select set_config('app.uid','00000000-0000-0000-0000-0000000000ad',false)`);
ok((await q(`select count(*)::int n from catalog_provider_records`))[0].n>=3,'admin reads rows');
ok(!(await throws(`insert into catalog_provider_records(provider,provider_record_id,payload_policy) values ('apple','5','trimmed')`)),'admin insert ok');
await db.exec(`reset role`);
ok(await throws(`set role anon; select * from catalog_provider_records`),'anon has no access'); await db.exec(`reset role`);
// provenance columns work and keep old data
await db.exec(`update catalog_metadata_candidates set raw_value='"2022-04-26"', provider_record_id=(select id from catalog_provider_records where provider_record_id='OL1W')`);
ok((await q(`select count(*)::int n from catalog_metadata_candidates where source_name='app' and field_name='year'`))[0].n===1,'existing candidate intact');
// rollback
await db.exec(rb); await db.exec(rb); ok(true,'rollback runs twice');
ok((await q(`select to_regclass('public.catalog_provider_records') t`))[0].t===null,'table gone');
ok((await q(`select count(*)::int n from information_schema.columns where table_name='catalog_metadata_candidates' and column_name in ('provider_record_id','raw_value')`))[0].n===0,'new columns gone');
const left = await q(`select field_name, field_value, source_name, status from catalog_metadata_candidates`);
ok(left.length===1 && left[0].field_name==='year' && left[0].source_name==='app','existing candidate survives rollback');
ok((await q(`select count(*)::int n from catalog_works`))[0].n===before[0].n,'works untouched');
console.log(`pass ${pass} fail ${fail}`);
