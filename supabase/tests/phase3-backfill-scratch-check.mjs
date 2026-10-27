// Scratch-database check for the Phase 3 genres/honors backfill + rollback. Never touches Supabase. phase3-labelsets.txt = the label sets and counts the dry-run used (labels only).
// Run: mkdir /tmp/pgtest && cd /tmp/pgtest && npm i @electric-sql/pglite && cp <repo>/supabase/tests/phase3-backfill-scratch-check.mjs b.mjs && REPO=<repo> node b.mjs   (expect: pass 11 fail 0)
import { PGlite } from '@electric-sql/pglite'; import fs from 'fs';
const R=(process.env.REPO||'.')+'/supabase/';
const bf=fs.readFileSync(R+'backfills/20261027_genres_honors_backfill.sql','utf8'), rb=fs.readFileSync(R+'rollbacks/20261027_genres_honors_backfill.rollback.sql','utf8');
const sets=fs.readFileSync(R+'tests/phase3-labelsets.txt','utf8').split('\n').filter(Boolean).map(l=>{const i=l.lastIndexOf('|');return [l.slice(0,i).split(' || '),+l.slice(i+1)]});
const db=new PGlite(); let pass=0,fail=0; const ok=(c,m)=>{c?pass++:(fail++,console.log('FAIL',m))}; const q=async s=>(await db.query(s)).rows;
await db.exec(`create table catalog_works(id uuid primary key default gen_random_uuid(), canonical_title text, genres text[] not null default '{}', honors text[] not null default '{}', updated_at timestamptz default now());
create table catalog_metadata_candidates(id uuid primary key default gen_random_uuid(), work_id uuid references catalog_works(id), field_name text, field_value jsonb, status text default 'candidate');
create table catalog_private_notes(id uuid primary key default gen_random_uuid(), work_id uuid not null references catalog_works(id) on delete cascade, target_table text not null, target_id uuid, kind text not null default 'note' check (kind in ('note','rejection')), note text not null, created_at timestamptz default now());`);
let n=0; for(const [labels,c] of sets) for(let i=0;i<c;i++){ n++; const id=(await q(`insert into catalog_works(canonical_title) values ('w${n}') returning id`))[0].id; for(const l of labels) await db.query(`insert into catalog_metadata_candidates(work_id,field_name,field_value) values ($1,'genre',$2::jsonb)`,[id,JSON.stringify(l)]); }
// extras: a rejected-only candidate work, a work that already has genres (must not be touched), a work with no candidates
const rej=(await q(`insert into catalog_works(canonical_title) values ('rejected') returning id`))[0].id; await db.query(`insert into catalog_metadata_candidates(work_id,field_name,field_value,status) values ($1,'genre','"Fantasy"','rejected')`,[rej]);
const pre=(await q(`insert into catalog_works(canonical_title,genres) values ('hasgenre','{Keepme}') returning id`))[0].id; await db.query(`insert into catalog_metadata_candidates(work_id,field_name,field_value) values ($1,'genre','"Fiction"')`,[pre]);
await q(`insert into catalog_works(canonical_title) values ('none')`);
ok(n===276,'seeded 276 works');
await db.exec(bf);
ok((await q(`select count(*)::int c from catalog_works where cardinality(genres)>0 and canonical_title<>'hasgenre'`))[0].c===226,'226 genres filled');
ok((await q(`select count(*)::int c from catalog_works where cardinality(honors)>0`))[0].c===44,'44 honors filled');
ok((await q(`select count(*)::int c from catalog_private_notes`))[0].c===270,'270 audit notes');
ok((await q(`select genres::text g from catalog_works where id='${pre}'`))[0].g==='{Keepme}','existing genres untouched');
ok((await q(`select count(*)::int c from catalog_works where id='${rej}' and cardinality(genres)=0`))[0].c===1,'rejected-only candidate not used');
ok((await q(`select count(*)::int c from catalog_works where cardinality(genres)>0 and cardinality(honors)>0`))[0].c===0,'no work gets both');
const sample=await q(`select genres::text g, count(*)::int c from catalog_works where cardinality(genres)>0 group by 1 order by 2 desc limit 3`); console.log(JSON.stringify(sample));
await db.exec(bf); ok((await q(`select count(*)::int c from catalog_private_notes`))[0].c===270,'second run adds nothing (fill-only)');
await db.exec(rb); ok((await q(`select count(*)::int c from catalog_works where cardinality(genres)>0 or cardinality(honors)>0`))[0].c===1,'rollback empties exactly the touched works (only the pre-existing one remains)');
ok((await q(`select genres::text g from catalog_works where id='${pre}'`))[0].g==='{Keepme}','pre-existing genres survive rollback');
ok((await q(`select count(*)::int c from catalog_private_notes`))[0].c===0,'notes removed');
console.log(`pass ${pass} fail ${fail}`);
