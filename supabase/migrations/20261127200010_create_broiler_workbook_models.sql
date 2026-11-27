-- Broiler workbook calculation model: one editable model per Broiler enterprise.
-- RLS follows the existing enterprise-level farmer/admin access policy.
create table if not exists public.broiler_workbook_models (
  id uuid primary key default gen_random_uuid(),
  enterprise_id uuid not null unique references public.farm_enterprises(id) on delete cascade,
  model_version integer not null default 1 check (model_version > 0),
  model_data jsonb not null default '{}'::jsonb check (jsonb_typeof(model_data) = 'object'),
  updated_by uuid references auth.users(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

alter table public.broiler_workbook_models enable row level security;

create policy "Farmers and admins access broiler workbook models"
on public.broiler_workbook_models
for all
to authenticated
using (agripredict_private.can_access_enterprise(enterprise_id))
with check (agripredict_private.can_access_enterprise(enterprise_id));

grant select, insert, update, delete on public.broiler_workbook_models to authenticated;

comment on table public.broiler_workbook_models is
'Per-enterprise editable broiler workbook model: source worksheet formulations, daily intake schedule, laying percentages and versioned calculation inputs.';
