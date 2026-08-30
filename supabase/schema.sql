-- Agent Runway mobile companion. This table is reachable only from the
-- Edge Function's service role; browsers and desktop clients never receive
-- direct table privileges.
create table if not exists public.agent_runway_mobile_snapshots (
  device_id uuid primary key,
  write_secret_hash text not null check (write_secret_hash ~ '^[0-9a-f]{64}$'),
  share_token_hash text unique check (share_token_hash is null or share_token_hash ~ '^[0-9a-f]{64}$'),
  payload jsonb not null,
  observed_at timestamptz not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  revoked_at timestamptz
);

alter table public.agent_runway_mobile_snapshots enable row level security;

create policy "deny direct client access"
  on public.agent_runway_mobile_snapshots
  as restrictive
  for all
  to anon, authenticated
  using (false)
  with check (false);

revoke all on table public.agent_runway_mobile_snapshots from anon, authenticated;
grant all on table public.agent_runway_mobile_snapshots to service_role;

create index if not exists agent_runway_mobile_snapshots_active_share_idx
  on public.agent_runway_mobile_snapshots (share_token_hash)
  where revoked_at is null;
