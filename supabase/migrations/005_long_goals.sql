begin;
-- Private long-term goals; independent of task lists and planning cycles.
create table if not exists public.long_goal_books (
  owner_id uuid primary key references auth.users(id) on delete cascade,
  revision bigint not null check (revision > 0),
  data jsonb not null check (
    jsonb_typeof(data) = 'object' and data ?& array['version','goals'] and data->>'version' = '1' and jsonb_typeof(data->'goals') = 'array'
  )
);
alter table public.long_goal_books enable row level security;
revoke all on public.long_goal_books from anon, authenticated;
grant select, insert, update on public.long_goal_books to authenticated;
create policy long_goal_read on public.long_goal_books for select to authenticated using (owner_id = (select auth.uid()));
create policy long_goal_insert on public.long_goal_books for insert to authenticated with check (owner_id = (select auth.uid()) and revision = 1);
create policy long_goal_update on public.long_goal_books for update to authenticated using (owner_id = (select auth.uid())) with check (owner_id = (select auth.uid()));
create or replace function public.guard_long_goal_revision() returns trigger language plpgsql set search_path = public as $$
begin
  if new.owner_id <> old.owner_id or new.revision <> old.revision + 1 then
    raise exception 'Goals revision conflict';
  end if;
  return new;
end;
$$;
create trigger long_goal_revision before update on public.long_goal_books for each row execute function public.guard_long_goal_revision();
commit;
