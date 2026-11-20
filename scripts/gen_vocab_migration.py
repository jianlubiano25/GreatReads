#!/usr/bin/env python3
"""Generates supabase/migrations/20261115000002_vocabulary_expansion.sql (+ its exact rollback) from the spec below. Re-run after editing the spec."""
import re
def slug(s): return re.sub(r'(^-|-$)', '', re.sub(r'[^a-z0-9]+', '-', s.lower().replace('&', 'and')))
NEW = {  # kind -> new term names (existing names are skipped by the insert)
 'genre': ['Adventure', 'Art', 'Education', 'Health & wellness', 'Finance', 'Comics', 'Nature', 'Technology'],
 'subgenre': ['Gothic', 'Magical realism', 'High fantasy', 'Dark fantasy', 'Fantasy romance', 'Romantasy', 'Romantic suspense', 'Hard science fiction', 'Science fantasy',
              'Police procedural', 'Political fiction', 'Epistolary fiction', 'Bildungsroman', 'Fairy tales & fables', 'New adult', 'Mystery thriller', 'Cyberpunk', 'Sword and sorcery'],
 'subject': ['Coming of age', 'War', 'Grief', 'Orphans', 'Revenge', 'Betrayal', 'Survival', 'Good and evil', 'Death', 'Mental health', 'Slavery', 'Holocaust', 'World War II',
             'Espionage', 'Leadership', 'Marriage & divorce', 'Siblings', 'Parents & children', 'Bullying', 'Social class', 'Race relations', 'Artificial intelligence',
             'Enemies to lovers', 'Slow burn', 'Found family', 'Women', 'LGBTQ+', 'Schools', 'Identity', 'Power & politics', 'Religion & faith', 'Immigration', 'Justice', 'Addiction'],
 'collection': ['New York Times reviewed', 'Open Library staff picks', 'Long Now Manual for Civilization', 'Open Syllabus Project', 'Goodreads Choice'],
}
KIND_OF = {n: k for k, v in NEW.items() for n in v}
ALIAS = {  # term name -> labels (normalised, lower case) that mean it. Existing terms are named exactly as in catalog_terms.
 'Fantasy': ['fantasy fiction', 'english fantasy fiction', 'fantasy & magic', 'fantastic fiction', 'novela fantástica', 'science fiction & fantasy', 'sci-fi & fantasy'],
 'Science fiction': ['sci-fi', 'science-fiction', 'american science fiction', 'english science fiction', 'science fiction & fantasy', 'sci-fi & fantasy', 'life on other planets', 'extraterrestrial beings', 'interplanetary voyages'],
 "Children's": ["children's fiction", "children's stories", 'juvenile fiction', 'juvenile literature', 'juvenile works', "children's literature", 'children', 'picture books', 'juvenile nonfiction', 'toy and movable books', 'romans, nouvelles, etc. pour la jeunesse', 'ficción juvenil'],
 'Young adult': ['young adult fiction', 'teenagers', 'adolescence'],
 'Classic': ['classics', 'classic literature', 'classic fiction', 'fiction classics'],
 'Non-fiction': ['nonfiction', 'non fiction'],
 'Biography': ['biography & autobiography', 'biographies', 'biographies & memoirs', 'biography & memoir', 'biografía'],
 'Memoir': ['autobiography', 'diaries', 'personal narratives', 'diary fiction'],
 'Literary fiction': ['literary', 'fiction, literary', 'literature & fiction', 'fiction & literature', 'literature and fiction', 'general fiction'],
 'Contemporary': ['contemporary fiction'],
 'Thriller': ['suspense', 'thrillers', 'thriller & suspense', 'suspense & thriller', 'thrillers & suspense', 'mysteries & thrillers', 'fiction, thrillers, suspense'],
 'Mystery': ['mystery & detective', 'detective and mystery stories', 'mystery fiction', 'mysteries'],
 'Mystery thriller': ['mystery thriller'],
 'Historical fiction': ['historical', 'historical-fiction', 'fiction, historical', 'fiction, historical, general'],
 'Romance': ['romance fiction', 'love stories', 'fiction, romance, general', 'romances'],
 'Horror': ['horror tales', 'horror stories', 'fiction, horror', 'ghost stories'],
 'Humor': ['humorous', 'humorous stories', 'humour', 'comedy & humor', 'fiction, humorous, general'],
 'Self-help': ['self help', 'self-improvement', 'personal development', 'personal growth', 'self-help techniques', 'self-actualization (psychology)'],
 'Spirituality': ['religion & spirituality', 'mind & spirit', 'spiritual life', 'new age'],
 'Graphic novels': ['comics & graphic novels', 'comic books', 'cartoons and comics', 'comics', 'comic books, strips', 'strips'],
 'Manga': ['form:manga', 'form:manga volume'],
 'Cookbooks': ['cooking'],
 'Business': ['business & economics', 'success in business', 'management'],
 'Finance': ['personal finance', 'finance'],
 'Christian': ['christian fiction'],
 'Politics': ['political science', 'political'],
 'Philosophy': ['morale pratique'],
 'Short stories': ['short stories (single author)', 'literary collections'],
 'Health & wellness': ['health', 'medical', 'meditation', 'body'],
 'Education': ['education', 'study and teaching'],
 'Comics': ['comics'],
 'Dystopian': ['dystopia', 'dystopias', 'totalitarianism'],
 'Mythology': ['greek mythology', 'myths', 'legends', 'gods', 'mitología griega', 'fables'],
 'Magic': ['witches', 'wizards', 'magos', 'demonology'],
 'Murder': ['murderers'],
 'Friendship': ['amitié', 'amistad', 'male friendship'],
 'Family': ['families', 'family life', 'family relationships', 'dysfunctional families', 'familles', 'family fiction & literature'],
 'Love': ['man-woman relationships', 'courtship', 'married people'],
 'Family & relationships': ['interpersonal relations', 'relationships'],
 'Coming of age': ['coming of age', 'bildungsromans', 'bildungsroman'],
 'War': ['war', 'war & military', 'military', 'imaginary wars and battles'],
 'World War II': ['1939-1945', 'jewish (1939-1945)', 'world war', 'guerre mondiale'],
 'Orphans': ['orphans', 'foster homes'],
 'Siblings': ['sisters', 'brothers', 'brothers and sisters'],
 'Parents & children': ['mothers and daughters', 'mothers and sons', 'parent and child'],
 'Marriage & divorce': ['marriage', 'divorce', 'marriage & divorce'],
 'Social class': ['social classes', 'rich people', 'wealth'],
 'Race relations': ['race relations', 'african americans', 'african american'],
 'Women': ['women', 'women authors', 'young women', 'single women', 'african american women', 'contemporary women'],
 'LGBTQ+': ['lgbtq', 'lgbtq+', 'lgbt', 'queer', 'gay', 'sapphic'],
 'Schools': ['schools', 'school stories', 'middle schools', 'escuelas', 'college students'],
 'Gothic': ['gothic'], 'Magical realism': ['magical realism'], 'High fantasy': ['high fantasy'], 'Dark fantasy': ['dark fantasy'], 'Fantasy romance': ['fantasy romance'], 'Romantasy': ['romantasy'],
 'Romantic suspense': ['romantic suspense'], 'Hard science fiction': ['hard science fiction'], 'Science fantasy': ['genre:science fantasy'], 'Police procedural': ['police procedural'],
 'Political fiction': ['political fiction'], 'Epistolary fiction': ['epistolary fiction'], 'Fairy tales & fables': ['fairy tales'], 'New adult': ['new adult'], 'Cyberpunk': ['cyberpunk'],
 'Enemies to lovers': ['enemies to lovers'], 'Slow burn': ['slow burn'], 'Found family': ['found family'],
 'New York Times reviewed': ['new york times reviewed'], 'Open Library staff picks': ['open library staff picks'], 'Long Now Manual for Civilization': ['long now manual for civilization'],
 'Open Syllabus Project': ['open_syllabus_project'], 'New York Times bestseller': ['new york times bestseller', 'spiegel-bestseller'], 'Prize winner': ['award winning books'],
 'Grief': ['grief'], 'Revenge': ['revenge'], 'Betrayal': ['betrayal'], 'Survival': ['survival'], 'Good and evil': ['good and evil'], 'Death': ['death'], 'Mental health': ['mental health'],
 'Slavery': ['slavery'], 'Holocaust': ['holocaust'], 'Espionage': ['espionage'], 'Leadership': ['leadership'], 'Bullying': ['bullying'], 'Artificial intelligence': ['artificial intelligence'],
 'Art': ['art'], 'Nature': ['animals', 'evolution', 'biology'], 'Technology': ['genetic engineering', 'video games'],
}
REQ = {('epic', 'Epic fantasy'): 'Fantasy', ('epic fiction', 'Epic fantasy'): 'Fantasy', ('psychological', 'Psychological thriller'): 'Thriller', ('adventure', 'Adventure'): None, ('action & adventure', 'Adventure'): None,
       ('adventure stories', 'Adventure'): None, ('adventure and adventurers', 'Adventure'): None, ('genre:adventure', 'Adventure'): None}
ALIAS.setdefault('Epic fantasy', []).extend(['epic', 'epic fiction']); ALIAS.setdefault('Psychological thriller', []).append('psychological'); ALIAS.setdefault('Adventure', []).extend(['adventure', 'action & adventure', 'adventure stories', 'adventure and adventurers', 'genre:adventure'])
NOISE = ['reading level-grade %d' % i for i in range(1, 13)] + ['large type books', 'spanish language materials', 'readers', 'general', 'did-not-finish', 'specimens', 'case studies',
         'manuscripts', 'texts', 'dictionaries', 'translations from english', 'translations into english', 'adaptations', 'etc', 'etc.', 'fictional works', 'fiction in english', 'audiobook',
         'audiobooks', 'books', 'media tie-in', 'early works to 1800', 'history and criticism', 'criticism and interpretation', 'english language', 'german language', 'french language']
q = lambda s: "'" + s.replace("'", "''") + "'"
out = ['-- Vocabulary expansion (owner go 2026-11-15): more genres, subgenres, subjects & themes and collections, and the provider labels that mean them (aliases), from the labels on 10k provider records.',
       '-- Additive only: new terms + aliases; noise labels (reading levels, large print, "General"...) are set to status rejected (hidden, reversible). Generated by scripts/gen_vocab_migration.py.',
       '-- Rollback: supabase/rollbacks/20261115000002_vocabulary_expansion.rollback.sql']
vals = ',\n  '.join('(%s, %s, %s)' % (q(k), q(n), q(slug(n))) for k, ns in NEW.items() for n in ns)
out.append('insert into public.catalog_terms (kind, name, slug) select v.kind, v.name, v.slug from (values\n  %s\n) as v(kind, name, slug)\nwhere not exists (select 1 from public.catalog_terms t where t.kind = v.kind and t.slug = v.slug);' % vals)
rows = []
for term, labels in ALIAS.items():
    for l in dict.fromkeys(labels):
        req = {('epic', 'Epic fantasy'): 'Fantasy', ('epic fiction', 'Epic fantasy'): 'Fantasy', ('psychological', 'Psychological thriller'): 'Thriller'}.get((l, term))
        rows.append('(%s, %s, %s)' % (q(term), q(l), q(req) if req else 'null'))
out.append('insert into public.catalog_term_aliases (source, label_norm, term_id, requires_genre)\nselect \'any\', v.label, t.id, v.req from (values\n  %s\n) as v(term, label, req)\njoin lateral (select id from public.catalog_terms where lower(name) = lower(v.term) order by case kind when \'genre\' then 0 when \'subgenre\' then 1 when \'subject\' then 2 else 3 end limit 1) t on true\nwhere not exists (select 1 from public.catalog_term_aliases a where a.source = \'any\' and a.label_norm = v.label and a.term_id = t.id);' % ',\n  '.join(rows))
out.append("update public.catalog_work_labels set status = 'rejected' where status = 'candidate' and (label_norm = any (array[%s]) or label_norm ~ '^(reading level|collectionid:|nyt:series_books|intended public:)');" % ', '.join(q(n) for n in NOISE))
open('supabase/migrations/20261115000002_vocabulary_expansion.sql', 'w').write('\n'.join(out) + '\n')
rb = ['-- Undo 20261115000002: removes exactly the aliases and terms this migration added, and puts the hidden noise labels back to candidate.',
      "update public.catalog_work_labels set status = 'candidate' where status = 'rejected' and (label_norm = any (array[%s]) or label_norm ~ '^(reading level|collectionid:|nyt:series_books|intended public:)');" % ', '.join(q(n) for n in NOISE),
      "delete from public.catalog_work_terms where term_id in (select id from public.catalog_terms where (kind, slug) in (%s));" % ', '.join('(%s, %s)' % (q(k), q(slug(n))) for k, ns in NEW.items() for n in ns),
      "delete from public.catalog_term_aliases a using (values %s) v(label, term) where a.label_norm = v.label and a.term_id in (select id from public.catalog_terms where lower(name) = lower(v.term)) and a.source = 'any' and a.id not in (select id from public.catalog_term_aliases limit 0);" % ', '.join('(%s, %s)' % (q(l), q(t)) for t, ls in ALIAS.items() for l in dict.fromkeys(ls)),
      "delete from public.catalog_terms where (kind, slug) in (%s);" % ', '.join('(%s, %s)' % (q(k), q(slug(n))) for k, ns in NEW.items() for n in ns)]
open('supabase/rollbacks/20261115000002_vocabulary_expansion.rollback.sql', 'w').write('\n'.join(rb) + '\n')
print(len(rows), 'aliases', sum(len(v) for v in NEW.values()), 'terms')
