-- Holland_Game 2.0 — Supabase setup
-- Run the whole script in Supabase SQL Editor.
-- Players use Supabase Anonymous Auth; enable Authentication > Providers > Anonymous Sign-Ins.
-- The browser contains only the public anon/publishable key. Never expose service_role.

create table if not exists public.player_profiles (
  user_id uuid primary key references auth.users(id) on delete cascade,
  username text not null unique check (char_length(username) between 3 and 18),
  company_income numeric(18,2) not null default 0 check (company_income >= 0),
  balance numeric(18,2) not null default 0 check (balance >= 0),
  companies_count integer not null default 0 check (companies_count >= 0),
  lifetime_earned numeric(18,2) not null default 0 check (lifetime_earned >= 0),
  updated_at timestamptz not null default now()
);

alter table public.player_profiles add column if not exists lifetime_earned numeric(18,2) not null default 0;
alter table public.player_profiles add column if not exists balance numeric(18,2) not null default 0;
alter table public.player_profiles add column if not exists updated_at timestamptz not null default now();

-- Private, complete player save. Each authenticated player can read/write only their own row.
create table if not exists public.player_saves (
  user_id uuid primary key references auth.users(id) on delete cascade,
  save_data jsonb not null default '{}'::jsonb,
  updated_at timestamptz not null default now()
);

create table if not exists public.player_collectibles (
  user_id uuid not null references auth.users(id) on delete cascade,
  item_id text not null,
  quantity integer not null default 0 check (quantity >= 0),
  updated_at timestamptz not null default now(),
  primary key (user_id, item_id)
);

create table if not exists public.ah_listings (
  id uuid primary key default gen_random_uuid(),
  seller_id uuid not null references auth.users(id) on delete cascade,
  seller_username text not null,
  item_id text not null,
  item_name text not null,
  rarity text not null check (rarity in ('common','uncommon','rare','epic','legendary','mythic')),
  price numeric(18,2) not null check (price > 0),
  status text not null default 'active' check (status in ('active','sold','cancelled')),
  created_at timestamptz not null default now()
);

create index if not exists ah_listings_active_created_idx on public.ah_listings(status, created_at desc);
create index if not exists player_profiles_income_idx on public.player_profiles(company_income desc);

alter table public.player_profiles enable row level security;
alter table public.player_saves enable row level security;
alter table public.player_collectibles enable row level security;
alter table public.ah_listings enable row level security;

-- Re-runnable policies.
drop policy if exists "leaderboard profiles readable" on public.player_profiles;
drop policy if exists "profile owner all" on public.player_profiles;
drop policy if exists "own save all" on public.player_saves;
drop policy if exists "own collectibles readable" on public.player_collectibles;
drop policy if exists "active listings readable" on public.ah_listings;
drop policy if exists "seller inserts own listings" on public.ah_listings;
drop policy if exists "seller updates own listings" on public.ah_listings;

create policy "leaderboard profiles readable" on public.player_profiles
  for select to anon, authenticated using (true);
create policy "profile owner all" on public.player_profiles
  for all to authenticated
  using (auth.uid() = user_id)
  with check (auth.uid() = user_id);
create policy "own save all" on public.player_saves
  for all to authenticated
  using (auth.uid() = user_id)
  with check (auth.uid() = user_id);
create policy "own collectibles readable" on public.player_collectibles
  for select to authenticated using (auth.uid() = user_id);
create policy "active listings readable" on public.ah_listings
  for select to anon, authenticated using (status = 'active' or auth.uid() = seller_id);
create policy "seller inserts own listings" on public.ah_listings
  for insert to authenticated with check (auth.uid() = seller_id and status = 'active');
create policy "seller updates own listings" on public.ah_listings
  for update to authenticated using (auth.uid() = seller_id and status = 'active')
  with check (auth.uid() = seller_id and status = 'cancelled');

grant select on public.player_profiles to anon, authenticated;
grant insert, update, select on public.player_profiles to authenticated;
grant select, insert, update, delete on public.player_saves to authenticated;
grant select on public.ah_listings to anon, authenticated;
grant insert, update on public.ah_listings to authenticated;
grant select on public.player_collectibles to authenticated;

-- Atomic player-to-player purchase. This function transfers the item and currency
-- inside one database transaction; a player cannot buy their own listing or spend
-- more than their saved balance. The browser never receives the service-role key.
create or replace function public.purchase_ah_listing(p_listing_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_buyer uuid := auth.uid();
  v_listing public.ah_listings%rowtype;
  v_price_cents bigint;
  v_buyer_save jsonb;
  v_seller_save jsonb;
  v_buyer_balance bigint;
  v_seller_balance bigint;
  v_buyer_qty bigint;
  v_seller_lifetime bigint;
begin
  if v_buyer is null then
    raise exception 'Je moet ingelogd zijn om te kopen.';
  end if;

  select * into v_listing
  from public.ah_listings
  where id = p_listing_id and status = 'active'
  for update;

  if not found then
    raise exception 'Deze aanbieding is niet meer beschikbaar.';
  end if;
  if v_listing.seller_id = v_buyer then
    raise exception 'Je kunt je eigen aanbieding niet kopen.';
  end if;

  v_price_cents := round(v_listing.price * 100)::bigint;
  select save_data into v_buyer_save
  from public.player_saves where user_id = v_buyer for update;
  if not found then
    raise exception 'Spelerssave niet gevonden. Herlaad de game en probeer opnieuw.';
  end if;

  v_buyer_balance := coalesce((v_buyer_save->>'balance')::bigint, 0);
  if v_buyer_balance < v_price_cents then
    raise exception 'Niet genoeg Kaasmunten.';
  end if;
  v_buyer_qty := coalesce((v_buyer_save->'collectibles'->>v_listing.item_id)::bigint, 0);
  v_buyer_save := jsonb_set(v_buyer_save, '{balance}', to_jsonb(v_buyer_balance - v_price_cents), true);
  v_buyer_save := jsonb_set(v_buyer_save, array['collectibles', v_listing.item_id], to_jsonb(v_buyer_qty + 1), true);

  select save_data into v_seller_save
  from public.player_saves where user_id = v_listing.seller_id for update;
  if not found then
    raise exception 'Save van de verkoper niet gevonden. De aankoop is niet uitgevoerd.';
  end if;
  v_seller_balance := coalesce((v_seller_save->>'balance')::bigint, 0);
  v_seller_lifetime := coalesce((v_seller_save->>'lifetimeEarned')::bigint, 0);
  v_seller_save := jsonb_set(v_seller_save, '{balance}', to_jsonb(v_seller_balance + v_price_cents), true);
  v_seller_save := jsonb_set(v_seller_save, '{lifetimeEarned}', to_jsonb(v_seller_lifetime + v_price_cents), true);
  v_seller_save := jsonb_set(v_seller_save, '{lastSeenAt}', to_jsonb(floor(extract(epoch from now()) * 1000)::bigint), true);

  update public.player_saves set save_data = v_buyer_save, updated_at = now() where user_id = v_buyer;
  update public.player_saves set save_data = v_seller_save, updated_at = now() where user_id = v_listing.seller_id;
  update public.ah_listings set status = 'sold' where id = v_listing.id;

  return jsonb_build_object('buyer_save', v_buyer_save, 'listing_id', v_listing.id);
end;
$$;

revoke all on function public.purchase_ah_listing(uuid) from public;
grant execute on function public.purchase_ah_listing(uuid) to authenticated;

-- Note: the save is a trusted-friends prototype. The public leaderboard exposes
-- username, current Kaasmunten balance, company income and company count; inventory
-- and the full save_data stay private per player.
-- The client writes its own account row using Supabase Auth + RLS (no service key in browser).
