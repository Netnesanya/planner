begin;
-- Private financial book; sharing planner lists never shares financial data.
create table if not exists public.finance_books (
  owner_id uuid primary key references auth.users(id) on delete cascade,
  revision bigint not null check (revision > 0),
  data jsonb not null check (
    jsonb_typeof(data) = 'object' and data ?& array['version','accounts','categories','transactions','templates','payments'] and data->>'version' = '1'
    and jsonb_typeof(data->'accounts') = 'array'
    and jsonb_typeof(data->'categories') = 'array'
    and jsonb_typeof(data->'transactions') = 'array'
    and jsonb_typeof(data->'templates') = 'array'
    and jsonb_typeof(data->'payments') = 'array'
  )
);
alter table public.finance_books enable row level security;
revoke all on public.finance_books from anon, authenticated;
grant select, insert, update on public.finance_books to authenticated;
create policy finance_read on public.finance_books for select to authenticated using (owner_id = (select auth.uid()));
create policy finance_insert on public.finance_books for insert to authenticated with check (owner_id = (select auth.uid()) and revision = 1);
create policy finance_update on public.finance_books for update to authenticated using (owner_id = (select auth.uid())) with check (owner_id = (select auth.uid()));
create or replace function public.guard_finance_revision() returns trigger language plpgsql set search_path = public as $$
begin
  if new.owner_id <> old.owner_id or new.revision <> old.revision + 1 then
    raise exception 'Finance revision conflict';
  end if;
  return new;
end;
$$;
create trigger finance_revision before update on public.finance_books for each row execute function public.guard_finance_revision();
commit;
