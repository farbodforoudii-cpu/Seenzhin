-- Live public catalog for the Seenzhin website (decision 21; docs/SITE-CONTRACT.md).
-- The app publishes only public fields with its space key; anyone may read the result. eco_items is never exposed.
create table if not exists public.site_catalogs (
  slug text primary key check (slug ~ '^[a-z0-9-]{3,40}$'),
  space_id uuid not null references public.eco_spaces(id) on delete cascade,
  data jsonb not null,
  updated_at timestamptz not null default now()
);
create table if not exists public.site_photos (
  slug text not null references public.site_catalogs(slug) on delete cascade,
  id text not null check (id ~ '^[A-Za-z0-9_-]{1,64}$'),
  data text not null check (length(data) <= 2500000 and data like 'data:image/%'),
  updated_at timestamptz not null default now(),
  primary key (slug, id)
);
alter table public.site_catalogs enable row level security;
alter table public.site_photos enable row level security;
revoke all on public.site_catalogs, public.site_photos from anon, authenticated;

-- App → server. Returns the photo ids the server still needs; drops photos no longer in the catalog.
create or replace function public.site_publish(p_key text, p_slug text, p_catalog jsonb)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare s uuid := public.eco_space(p_key); owner uuid; want text[]; missing jsonb;
begin
  if s is null then raise exception 'unknown sync key'; end if;
  if p_slug !~ '^[a-z0-9-]{3,40}$' then raise exception 'bad slug'; end if;
  if p_catalog->>'kind' is distinct from 'catalog' or jsonb_typeof(p_catalog->'items') <> 'array' then raise exception 'not a catalog'; end if;
  if pg_column_size(p_catalog) > 1000000 then raise exception 'catalog too large'; end if;
  select space_id into owner from public.site_catalogs where slug = p_slug;
  if owner is not null and owner <> s then raise exception 'slug taken'; end if;
  insert into public.site_catalogs (slug, space_id, data, updated_at) values (p_slug, s, p_catalog, now())
    on conflict (slug) do update set data = excluded.data, updated_at = now();
  select coalesce(array_agg(distinct ph->>'id'), '{}') into want
    from jsonb_array_elements(p_catalog->'items') it, jsonb_array_elements(coalesce(it->'photos', '[]'::jsonb)) ph;
  delete from public.site_photos where slug = p_slug and not (id = any(want));
  select coalesce(jsonb_agg(w), '[]'::jsonb) into missing from unnest(want) w
    where not exists (select 1 from public.site_photos p where p.slug = p_slug and p.id = w);
  return missing;
end $$;

-- App → server: one photo the catalog refers to.
create or replace function public.site_photo_put(p_key text, p_slug text, p_id text, p_data text)
returns boolean language plpgsql security definer set search_path = '' as $$
declare s uuid := public.eco_space(p_key);
begin
  if s is null then raise exception 'unknown sync key'; end if;
  if not exists (select 1 from public.site_catalogs c where c.slug = p_slug and c.space_id = s) then raise exception 'no catalog'; end if;
  if not exists (select 1 from public.site_catalogs c, jsonb_array_elements(c.data->'items') it, jsonb_array_elements(coalesce(it->'photos', '[]'::jsonb)) ph
                 where c.slug = p_slug and ph->>'id' = p_id) then raise exception 'photo not in catalog'; end if;
  insert into public.site_photos (slug, id, data, updated_at) values (p_slug, p_id, p_data, now())
    on conflict (slug, id) do update set data = excluded.data, updated_at = now();
  return true;
end $$;

-- Website → read only.
create or replace function public.site_catalog(p_slug text)
returns jsonb language sql stable security definer set search_path = '' as $$
  select data || jsonb_build_object('publishedAt', updated_at) from public.site_catalogs where slug = p_slug;
$$;
create or replace function public.site_photo(p_slug text, p_id text)
returns text language sql stable security definer set search_path = '' as $$
  select data from public.site_photos where slug = p_slug and id = p_id;
$$;

revoke all on function public.site_publish(text, text, jsonb), public.site_photo_put(text, text, text, text),
  public.site_catalog(text), public.site_photo(text, text) from public;
grant execute on function public.site_publish(text, text, jsonb), public.site_photo_put(text, text, text, text),
  public.site_catalog(text), public.site_photo(text, text) to anon, authenticated;
