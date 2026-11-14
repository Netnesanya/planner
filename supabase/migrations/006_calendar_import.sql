-- Stable calendar identities and atomic, optimistic import. Originally named 004_calendar_import.sql; do not rerun if already applied.
begin;
alter table public.tasks add column calendar_uid text check(length(calendar_uid) between 1 and 1024);
alter table public.tasks add column calendar_recurrence_id text check(length(calendar_recurrence_id)<=100);
create unique index tasks_calendar_identity on public.tasks(list_id,calendar_uid,coalesce(calendar_recurrence_id,'')) where calendar_uid is not null;

create function public.import_calendar_tasks(target_list uuid, changes jsonb) returns jsonb
language plpgsql security invoker set search_path = '' as $$
declare item jsonb; current_task public.tasks; expected_task public.tasks; incoming public.tasks;
begin
  if jsonb_typeof(changes) is distinct from 'array' then raise exception 'Invalid calendar import'; end if;
  if jsonb_array_length(changes) not between 1 and 2000 then raise exception 'Select between 1 and 2000 events'; end if;
  -- Serialize imports into a list; ordinary edits are checked under task row locks.
  perform id from public.lists where id=target_list;
  if not found then raise exception 'List not found or access denied'; end if;
  perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended(target_list::text,0));
  perform id from public.tasks where id in (select (value->'task'->>'id')::uuid from jsonb_array_elements(changes)) order by id for update;
  for item in select value from jsonb_array_elements(changes) loop
    incoming:=jsonb_populate_record(null::public.tasks,item->'task');
    if incoming.list_id is distinct from target_list or incoming.calendar_uid is null then raise exception 'Invalid calendar target'; end if;
    select * into current_task from public.tasks where id=incoming.id;
    if found then
      if current_task.list_id is distinct from target_list or item->'before' is null or item->'before'='null'::jsonb then raise exception 'Import preview is stale'; end if;
      expected_task:=jsonb_populate_record(null::public.tasks,item->'before');
      if current_task is distinct from expected_task then raise exception 'Import preview is stale; refresh it before applying'; end if;
    elsif item->'before' is distinct from 'null'::jsonb then
      raise exception 'Import preview is stale; task removed or access denied';
    end if;
  end loop;
  perform public.apply_task_changes((select jsonb_agg(value->'task') from jsonb_array_elements(changes)),'{}'::uuid[]);
  for item in select value from jsonb_array_elements(changes) loop
    incoming:=jsonb_populate_record(null::public.tasks,item->'task');
    update public.tasks set calendar_uid=incoming.calendar_uid,calendar_recurrence_id=incoming.calendar_recurrence_id where id=incoming.id;
    if not found then raise exception 'Calendar task could not be saved'; end if;
  end loop;
  return coalesce((select jsonb_agg(to_jsonb(t)) from public.tasks t),'[]'::jsonb);
end;
$$;
revoke all on function public.import_calendar_tasks(uuid,jsonb) from public,anon;
grant execute on function public.import_calendar_tasks(uuid,jsonb) to authenticated;
commit;
