-- Apply after 001_planner.sql. Existing tasks remain ordinary tasks.
begin;
alter table public.tasks add column is_milestone boolean not null default false;
alter table public.tasks add column milestone_color text not null default '#b9efc9' check(milestone_color ~ '^#[0-9A-Fa-f]{6}$');
alter table public.tasks add column goal_id uuid references public.tasks(id) on delete set null;
alter table public.tasks add constraint goal_not_self check(goal_id is distinct from id);
alter table public.tasks add constraint milestone_standalone check(not is_milestone or (goal_id is null and recurrence='none'));
create index tasks_goal on public.tasks(goal_id) where goal_id is not null;

-- A stable tag links actions across accessible lists. Unchanged links do not
-- prevent shared-list participants from editing a task if a goal is private.
create function private.check_task_goal() returns trigger
language plpgsql security definer set search_path = '' as $$
begin
  if new.goal_id is not null and (tg_op='INSERT' or new.goal_id is distinct from old.goal_id) and not exists(
    select 1 from public.tasks g where g.id=new.goal_id and g.is_milestone and (
      private.can_access_list(g.list_id) or exists(select 1 from public.tasks source where source.id=new.source_task_id and source.goal_id=new.goal_id and private.can_access_list(source.list_id))
    )
  ) then raise exception 'Связанный майлстоун недоступен'; end if;
  if tg_op='UPDATE' and not new.is_milestone and exists(select 1 from public.tasks where goal_id=old.id) then
    raise exception 'Сначала отвяжите задачи от майлстоуна';
  end if;
  return new;
end;
$$;
revoke all on function private.check_task_goal() from public, anon;
create trigger check_task_goal before insert or update on public.tasks for each row execute function private.check_task_goal();

create table public.planning_cycles (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid not null references auth.users(id) on delete cascade default auth.uid(),
  name text not null check(length(trim(name)) between 1 and 120),
  vision text not null default '' check(length(vision)<=5000),
  start_date date not null,
  goal_ids uuid[] not null default '{}' check(cardinality(goal_ids)<=100),
  reviews jsonb not null default '{}' check(jsonb_typeof(reviews)='object' and octet_length(reviews::text)<=150000),
  archived boolean not null default false
);
create index planning_cycles_owner on public.planning_cycles(owner_id);
alter table public.planning_cycles enable row level security;
create policy cycles_owner on public.planning_cycles for all to authenticated using(owner_id=(select auth.uid())) with check(owner_id=(select auth.uid()));
revoke all on public.planning_cycles from public, anon, authenticated;
grant select, insert, update, delete on public.planning_cycles to authenticated;

-- Preserve the action → goal link on recurrence; goals themselves never repeat.
create or replace function public.set_task_status(task_id uuid,new_status text) returns void
language plpgsql security invoker set search_path = '' as $$
declare task public.tasks;
begin
  if new_status not in ('todo','doing','done') then raise exception 'Invalid status'; end if;
  select * into task from public.tasks where id=task_id for update;
  if not found then raise exception 'Task not found or access denied'; end if;
  if task.status=new_status then return; end if;
  update public.tasks set status=new_status,completed_at=case when new_status='done' then now() else null end where id=task_id;
  if new_status='done' and task.recurrence<>'none' then
    insert into public.tasks(list_id,created_by,title,notes,due_date,start_time,duration,priority,recurrence,repeat_anchor,tags,subtasks,source_task_id,progress_mode,progress_target,progress_unit,goal_id)
    values(task.list_id,auth.uid(),task.title,task.notes,
      private.next_task_date(task.due_date,task.recurrence,task.repeat_anchor),task.start_time,task.duration,task.priority,
      task.recurrence,task.repeat_anchor,task.tags,
      coalesce((select jsonb_agg(jsonb_set(value,'{done}','false'::jsonb)) from jsonb_array_elements(task.subtasks)),'[]'::jsonb),task.id,task.progress_mode,task.progress_target,task.progress_unit,task.goal_id)
    on conflict(source_task_id) do nothing;
  end if;
end;
$$;
do $$ begin
  if exists(select 1 from pg_publication where pubname='supabase_realtime') then
    alter publication supabase_realtime add table public.planning_cycles;
  end if;
end $$;
commit;
