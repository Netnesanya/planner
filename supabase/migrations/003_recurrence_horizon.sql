-- Recurring occurrences are materialized for the next 84 calendar days.
begin;
alter table public.tasks add column series_id uuid;
alter table public.tasks add column series_date date;
alter table public.tasks add column series_modified boolean not null default false;
alter table public.tasks add column series_until date;
alter table public.tasks add column series_skips date[] not null default '{}';
create unique index tasks_series_occurrence on public.tasks(series_id,series_date) where series_id is not null;

-- One atomic write for editing a task and rebuilding its future occurrences.
-- Security invoker, normal table grants, RLS and identity triggers remain active.
create function public.apply_task_changes(task_rows jsonb, delete_ids uuid[] default '{}') returns jsonb
language plpgsql security invoker set search_path = '' as $$
declare item jsonb; row_value public.tasks; deleted_id uuid;
begin
  if jsonb_typeof(task_rows)<>'array' or jsonb_array_length(task_rows)>50000 or cardinality(delete_ids)>50000 then raise exception 'Invalid task batch'; end if;
  perform id from public.tasks where id in (select (value->>'id')::uuid from jsonb_array_elements(task_rows)) or id=any(delete_ids) order by id for update;
  foreach deleted_id in array delete_ids loop
    delete from public.tasks where id=deleted_id;
    if not found then raise exception 'Task not found or access denied'; end if;
  end loop;
  for item in select value from jsonb_array_elements(task_rows) loop
    row_value := jsonb_populate_record(null::public.tasks,item);
    if exists(select 1 from public.tasks where id=row_value.id) then
      update public.tasks set list_id=row_value.list_id,title=row_value.title,notes=row_value.notes,due_date=row_value.due_date,start_time=row_value.start_time,duration=row_value.duration,priority=row_value.priority,status=row_value.status,recurrence=row_value.recurrence,repeat_anchor=row_value.repeat_anchor,tags=row_value.tags,subtasks=row_value.subtasks,completed_at=row_value.completed_at,source_task_id=row_value.source_task_id,sort_order=row_value.sort_order,progress_mode=row_value.progress_mode,progress_value=row_value.progress_value,progress_target=row_value.progress_target,progress_unit=row_value.progress_unit,is_milestone=row_value.is_milestone,milestone_color=row_value.milestone_color,goal_id=row_value.goal_id,series_id=row_value.series_id,series_date=row_value.series_date,series_modified=row_value.series_modified,series_until=row_value.series_until,series_skips=row_value.series_skips
      where id=row_value.id;
    else
      insert into public.tasks select row_value.* on conflict (series_id,series_date) where series_id is not null do nothing;
    end if;
  end loop;
  return coalesce((select jsonb_agg(to_jsonb(t)) from public.tasks t),'[]'::jsonb);
end;
$$;
revoke all on function public.apply_task_changes(jsonb,uuid[]) from public,anon;
grant execute on function public.apply_task_changes(jsonb,uuid[]) to authenticated;

create or replace function public.set_task_status(task_id uuid,new_status text) returns void
language plpgsql security invoker set search_path = '' as $$
declare task public.tasks;
begin
  if new_status not in ('todo','doing','done') then raise exception 'Invalid status'; end if;
  select * into task from public.tasks where id=task_id for update;
  if not found then raise exception 'Task not found or access denied'; end if;
  if task.status=new_status then return; end if;
  update public.tasks set status=new_status,completed_at=case when new_status='done' then now() else null end where id=task_id;
  -- Backward-compatible fallback until a legacy series is opened in the new app.
  if new_status='done' and task.recurrence<>'none' and task.series_id is null then
    insert into public.tasks(list_id,created_by,title,notes,due_date,start_time,duration,priority,recurrence,repeat_anchor,tags,subtasks,source_task_id,progress_mode,progress_target,progress_unit,goal_id)
    values(task.list_id,auth.uid(),task.title,task.notes,
      private.next_task_date(task.due_date,task.recurrence,task.repeat_anchor),task.start_time,task.duration,task.priority,
      task.recurrence,task.repeat_anchor,task.tags,
      coalesce((select jsonb_agg(jsonb_set(value,'{done}','false'::jsonb)) from jsonb_array_elements(task.subtasks)),'[]'::jsonb),task.id,task.progress_mode,task.progress_target,task.progress_unit,task.goal_id)
    on conflict(source_task_id) do nothing;
  end if;
end;
$$;
commit;
