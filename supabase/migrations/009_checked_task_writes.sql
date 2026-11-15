begin;
create or replace function public.planner_capabilities() returns jsonb language sql stable security invoker set search_path='' as $$ select '{"checked_task_writes":true}'::jsonb $$;
create or replace function public.apply_task_changes_checked(changes jsonb) returns jsonb language plpgsql security invoker set search_path='' as $$
begin
  if changes is null or jsonb_typeof(changes)<>'array' or jsonb_array_length(changes) not between 1 and 50000 then raise exception 'Invalid task changes'; end if;
  return public.undo_task_changes((select jsonb_agg(jsonb_build_object('id',value->'id','before',value->'after','after',value->'before')) from jsonb_array_elements(changes)));
end;
$$;
revoke all on function public.planner_capabilities() from public,anon;
revoke all on function public.apply_task_changes_checked(jsonb) from public,anon;
grant execute on function public.planner_capabilities() to authenticated;
grant execute on function public.apply_task_changes_checked(jsonb) to authenticated;
commit;
