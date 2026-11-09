-- More aliases for the most common provider labels that mapped to nothing (data only). Owner go 2026-11-10 ("continue").
-- Left unmapped on purpose: ambiguous or topical labels (literature, drama, children, adventure, queer, success...): they stay in the raw layer.
insert into public.catalog_term_aliases (source, label_norm, term_id, requires_genre, implies_genre)
select v.source, v.label_norm, t.id, v.requires_genre, v.implies_genre
  from (values
  ('any','fiction, romance, general','Romance',null,null),
  ('any','love stories','Romance',null,null),
  ('any','enemies to lovers','Romance',null,null),
  ('any','fiction, fantasy, epic','Epic fantasy',null,'Fantasy'),
  ('any','witches','Magic',null,null),
  ('any','wizards','Magic',null,null),
  ('any','magia','Magic',null,null),
  ('any','fiction, horror','Horror',null,null),
  ('any','horror tales','Horror',null,null),
  ('any','horror fiction','Horror',null,null),
  ('any','fiction, historical','Historical fiction',null,null),
  ('any','historical','Historical fiction','Fiction',null),
  ('any','fiction, humorous, general','Humor',null,null),
  ('any','humorous fiction','Humor',null,null),
  ('any','thrillers','Thriller',null,null),
  ('any','suspense fiction','Thriller',null,null),
  ('any','paranormal fiction','Paranormal',null,null),
  ('any','autobiography','Biography',null,null),
  ('any','personal memoirs','Memoir',null,null),
  ('any','business & economics','Business',null,null),
  ('any','fiction, family life, general','Family',null,null),
  ('any','fiction, family life','Family',null,null),
  ('any','family life, fiction','Family',null,null),
  ('any','friendship, fiction','Friendship',null,null),
  ('any','literary','Literary fiction','Fiction',null),
  ('any','fiction, general','Fiction',null,null),
  ('any','novels','Fiction',null,null),
  ('any','romans','Fiction',null,null),
  ('any','children''s books','Children''s',null,null),
  ('any','child and youth fiction','Children''s',null,null),
  ('any','juvenile works','Children''s',null,null),
  ('any','novela juvenil','Children''s',null,null),
  ('any','romans, nouvelles, etc. pour la jeunesse','Children''s',null,null),
  ('any','personal growth','Self-help',null,null),
  ('any','self-actualization (psychology)','Self-help',null,null),
  ('any','sociology','Social science',null,null),
  ('any','description and travel','Travel',null,null)
  ) as v(source, label_norm, term_name, requires_genre, implies_genre)
  join public.catalog_terms t on t.name=v.term_name and t.status='active'
 where not exists (select 1 from public.catalog_term_aliases a where a.source=v.source and a.label_norm=v.label_norm and a.term_id=t.id);
