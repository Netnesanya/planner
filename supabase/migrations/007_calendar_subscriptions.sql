begin;
create table public.calendar_subscriptions (
 id uuid primary key default gen_random_uuid(),
 owner_id uuid not null references auth.users(id) on delete cascade,
 name text not null check(length(trim(name)) between 1 and 100),
 token_hash text not null unique check(token_hash ~ '^[a-f0-9]{64}$'),
 list_ids uuid[] not null check(cardinality(list_ids) between 1 and 50),
 timezone text not null,
 include_completed boolean not null default false,
 include_milestones boolean not null default true,
 created_at timestamptz not null default now(),
 revoked_at timestamptz
);
alter table public.calendar_subscriptions enable row level security;
create policy subscriptions_read on public.calendar_subscriptions for select to authenticated using(owner_id=auth.uid());
revoke all on public.calendar_subscriptions from public,anon,authenticated;
grant select(id,owner_id,name,list_ids,timezone,include_completed,include_milestones,created_at,revoked_at) on public.calendar_subscriptions to authenticated;

create function public.create_calendar_subscription(subscription_name text, digest text, selected_lists uuid[], zone text, completed boolean default false, milestones boolean default true) returns uuid
language plpgsql security definer set search_path='' as $$
declare result uuid; actor uuid:=auth.uid();
begin
 if actor is null then raise exception 'Authentication required'; end if;
 perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended(actor::text,7));
 if (select count(*) from public.calendar_subscriptions where owner_id=actor and revoked_at is null)>=10 then raise exception 'At most 10 active subscriptions'; end if;
 if selected_lists is null or cardinality(selected_lists) not between 1 and 50 or exists(select 1 from unnest(selected_lists) x where x is null or not private.can_access_list(x)) then raise exception 'Invalid lists or access denied'; end if;
 if cardinality(selected_lists)<>(select count(distinct x) from unnest(selected_lists) x) then raise exception 'Duplicate lists'; end if;
 if not exists(select 1 from pg_catalog.pg_timezone_names where name=zone) then raise exception 'Invalid timezone'; end if;
 insert into public.calendar_subscriptions(owner_id,name,token_hash,list_ids,timezone,include_completed,include_milestones)
 values(actor,trim(subscription_name),digest,selected_lists,zone,completed,milestones) returning id into result;
 return result;
end;
$$;
create function public.rotate_calendar_subscription(subscription_id uuid,digest text) returns void
language plpgsql security definer set search_path='' as $$
begin
 update public.calendar_subscriptions set token_hash=digest where id=subscription_id and owner_id=auth.uid() and revoked_at is null;
 if not found then raise exception 'Subscription not found'; end if;
end;
$$;
create function public.revoke_calendar_subscription(subscription_id uuid) returns void
language plpgsql security definer set search_path='' as $$
begin
 update public.calendar_subscriptions set revoked_at=coalesce(revoked_at,now()) where id=subscription_id and owner_id=auth.uid();
 if not found then raise exception 'Subscription not found'; end if;
end;
$$;
-- Only the Edge Function may resolve a bearer capability. Recheck current sharing rights
-- on every request; never trust an owner_id or list IDs supplied by an HTTP caller.
create function public.resolve_calendar_subscription(digest text) returns jsonb
language plpgsql security definer set search_path='' as $$
declare subscription public.calendar_subscriptions; allowed uuid[]; task_rows jsonb;
begin
 select * into subscription from public.calendar_subscriptions where token_hash=digest and revoked_at is null;
 if not found then return null; end if;
 select coalesce(array_agg(l.id),'{}') into allowed from public.lists l
 where l.id=any(subscription.list_ids) and (l.owner_id=subscription.owner_id or exists(select 1 from public.list_members m where m.list_id=l.id and m.user_id=subscription.owner_id));
 -- Fail closed after loss of any selected list. Do not retain or serve a cached feed.
 if cardinality(allowed)<>cardinality(subscription.list_ids) then return null; end if;
 -- Include accessible occurrences outside selected lists to avoid resurrecting a moved
 -- occurrence from a selected root. These records are never exported outside selection.
 select coalesce(jsonb_agg(to_jsonb(t)),'[]') into task_rows from (
 select t.* from public.tasks t where exists(select 1 from public.lists l where l.id=t.list_id and
 (l.owner_id=subscription.owner_id or exists(select 1 from public.list_members m where m.list_id=l.id and m.user_id=subscription.owner_id)))
 order by t.id limit 10001) t;
 if jsonb_array_length(task_rows)>10000 then raise exception 'Calendar task limit exceeded'; end if;
 return jsonb_build_object('subscription',to_jsonb(subscription)-'token_hash','tasks',task_rows,
 'occupied',coalesce((select jsonb_agg(jsonb_build_object('series_id',t.series_id,'series_date',t.series_date))
 from public.tasks t where t.series_id in (select root.id from public.tasks root where root.list_id=any(allowed) and root.series_id=root.id)
 and t.series_date is not null),'[]'::jsonb));
end;
$$;
revoke all on function public.create_calendar_subscription(text,text,uuid[],text,boolean,boolean),public.rotate_calendar_subscription(uuid,text),public.revoke_calendar_subscription(uuid) from public,anon;
grant execute on function public.create_calendar_subscription(text,text,uuid[],text,boolean,boolean),public.rotate_calendar_subscription(uuid,text),public.revoke_calendar_subscription(uuid) to authenticated;
revoke all on function public.resolve_calendar_subscription(text) from public,anon,authenticated;
grant execute on function public.resolve_calendar_subscription(text) to service_role;

-- A monotonic revision and modification date let clients reconcile changed events.
create sequence private.calendar_event_revision;
alter table public.tasks add column calendar_revision bigint;
alter table public.tasks add column calendar_updated_at timestamptz;
create function private.calendar_revision_stamp() returns trigger language plpgsql security definer set search_path='' as $$
begin
 if TG_OP='INSERT' then
   new.calendar_revision:=nextval('private.calendar_event_revision'); new.calendar_updated_at:=now();
 elsif (to_jsonb(new)-'calendar_revision'-'calendar_updated_at') is distinct from (to_jsonb(old)-'calendar_revision'-'calendar_updated_at') then
   new.calendar_revision:=nextval('private.calendar_event_revision'); new.calendar_updated_at:=now();
 else
   new.calendar_revision:=old.calendar_revision; new.calendar_updated_at:=old.calendar_updated_at;
 end if;
 return new;
end;
$$;
revoke all on function private.calendar_revision_stamp() from public,anon,authenticated;
update public.tasks set calendar_revision=nextval('private.calendar_event_revision'),calendar_updated_at=now();
create trigger calendar_revision_stamp before insert or update on public.tasks for each row execute function private.calendar_revision_stamp();
commit;
