import { test } from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { makeTask } from "../src/app/models";
import { saveRecurringTask, normalizeTask } from "../src/app/recurrence";
import { PGlite } from "@electric-sql/pglite";

for (const installation of ["migrations", "bundle"])
  test(`Supabase ${installation}: real PostgreSQL RLS, sharing, repeat transactions and revocation`, async (t) => {
    const db = new PGlite();
    await db.exec(`create role anon nologin; create role authenticated nologin;
    create schema auth; create table auth.users(id uuid primary key,email text);
    create function auth.uid() returns uuid language sql stable as $$ select nullif(current_setting('request.jwt.claim.sub',true),'')::uuid $$;
    grant usage on schema auth,public to authenticated,anon;
    grant execute on function auth.uid() to authenticated,anon;`);
    const sqlFiles =
      installation === "bundle"
        ? ["setup.sql"]
        : [
            "migrations/001_planner.sql",
            "migrations/002_goals_and_cycles.sql",
            "migrations/003_recurrence_horizon.sql",
            "migrations/004_finance.sql",
            "migrations/005_long_goals.sql",
          ];
    for (const file of sqlFiles)
      await db.exec(
        await readFile(new URL(`../supabase/${file}`, import.meta.url), "utf8"),
      );
    const alice = "11111111-1111-4111-8111-111111111111",
      bob = "22222222-2222-4222-8222-222222222222",
      eve = "33333333-3333-4333-8333-333333333333";
    const shared = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
      personal = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb",
      task = "cccccccc-cccc-4ccc-8ccc-cccccccccccc";
    await db.query(
      "insert into auth.users(id,email) values ($1,$2),($3,$4),($5,$6)",
      [
        alice,
        "alice@example.com",
        bob,
        "bob@example.com",
        eve,
        "eve@example.com",
      ],
    );
    const as = async (id: string) => {
      await db.exec("reset role");
      await db.query("select set_config('request.jwt.claim.sub',$1,false)", [
        id,
      ]);
      await db.exec("set role authenticated");
    };
    await as(alice);
    await db.query(
      "insert into lists(id,name,owner_id) values ($1,$2,$3),($4,$5,$3)",
      [shared, "Shared", alice, personal, "Private"],
    );
    await db.query(
      'insert into tasks(id,list_id,title,created_by,due_date,recurrence,repeat_anchor,subtasks) values ($1,$2,\'Monthly task\',$3,\'2026-01-31\',\'monthly\',31,\'[{"id":"one","title":"Step","done":true}]\')',
      [task, shared, alice],
    );
    await db.query(
      "insert into tasks(list_id,title,created_by) values ($1,'Secret task',$2)",
      [personal, alice],
    );

    await t.test(
      "private tasks and lists are invisible to another authenticated account",
      async () => {
        await as(bob);
        const result = await db.query("select * from tasks");
        assert.equal(result.rows.length, 0);
        const lists = await db.query("select * from lists");
        assert.equal(lists.rows.length, 1);
        assert.equal(
          (
            await db.query(
              "update tasks set title=$1 where id=$2 returning id",
              ["Hacked", task],
            )
          ).rows.length,
          0,
        );
        await assert.rejects(
          db.query(
            "insert into tasks(list_id,title,created_by) values ($1,'Unauthorized',$2)",
            [shared, bob],
          ),
          /row-level security/,
        );
      },
    );
    await t.test(
      "anonymous access and forged list ownership are denied",
      async () => {
        await as(bob);
        await assert.rejects(
          db.query("insert into lists(name,owner_id) values ('Forged',$1)", [
            alice,
          ]),
          /row-level security/,
        );
        await assert.rejects(
          db.query("select share_list($1,$2)", [shared, "eve@example.com"]),
          /Only the owner/,
        );
        await db.exec("reset role;set role anon");
        await assert.rejects(
          db.query("select * from tasks"),
          /permission denied/,
        );
        await assert.rejects(
          db.query("select share_list($1,$2)", [shared, "eve@example.com"]),
          /permission denied/,
        );
      },
    );
    await t.test(
      "only the owner can share; participant can read and edit only the shared list",
      async () => {
        await as(alice);
        await db.query("select share_list($1,$2)", [shared, "bob@example.com"]);
        await as(bob);
        assert.equal((await db.query("select * from tasks")).rows.length, 1);
        assert.equal(
          (
            await db.query(
              "update tasks set notes=$1 where id=$2 returning id",
              ["Shared edit", task],
            )
          ).rows.length,
          1,
        );
        await assert.rejects(
          db.query("insert into list_members(list_id,user_id) values($1,$2)", [
            shared,
            eve,
          ]),
          /permission denied/,
        );
        await assert.rejects(
          db.query("update lists set owner_id=$1 where id=$2", [bob, shared]),
          /permission denied/,
        );
        await assert.rejects(
          db.query("update tasks set created_by=$1 where id=$2", [bob, task]),
          /identity cannot be changed/,
        );
        await assert.rejects(
          db.query("update tasks set list_id=$1 where id=$2", [personal, task]),
          /row-level security/,
        );
        await assert.rejects(
          db.query("select list_members_info($1)", [shared]),
          /Only the owner/,
        );
      },
    );
    await t.test(
      "shared recurring task completes atomically; duplicate completion and undo do not create duplicates",
      async () => {
        await as(bob);
        await db.query(
          "update tasks set progress_mode='target',progress_target=5000,progress_value=3500,progress_unit='$' where id=$1",
          [task],
        );
        await db.query("select set_task_status($1,'done')", [task]);
        const result = await db.query<{
          status: string;
          source_task_id: string;
          due_date: string;
          subtasks: { done: boolean }[];
        }>(
          "select *,due_date::text as due_date from tasks order by tasks.due_date",
        );
        assert.equal(result.rows.length, 2);
        assert.equal(result.rows[0].status, "done");
        assert.equal(result.rows[1].due_date, "2026-02-28");
        assert.equal(result.rows[1].subtasks[0].done, false);
        assert.equal(result.rows[1].source_task_id, task);
        const progress = await db.query<{
          progress_value: string;
          progress_target: string;
        }>(
          "select progress_value,progress_target from tasks where source_task_id=$1",
          [task],
        );
        assert.equal(Number(progress.rows[0].progress_value), 0);
        assert.equal(Number(progress.rows[0].progress_target), 5000);
        assert.equal(
          Number(
            (
              await db.query<{ progress_value: string }>(
                "select progress_value from tasks where id=$1",
                [task],
              )
            ).rows[0].progress_value,
          ),
          3500,
        );

        await db.query("select set_task_status($1,'done')", [task]);
        await db.query("select set_task_status($1,'todo')", [task]);
        await db.query("select set_task_status($1,'done')", [task]);
        assert.equal((await db.query("select * from tasks")).rows.length, 2);
        const child = await db.query<{ id: string }>(
          "select id from tasks where source_task_id=$1",
          [task],
        );
        await db.query("select set_task_status($1,'done')", [child.rows[0].id]);
        assert.equal(
          (
            await db.query<{ due_date: string }>(
              "select due_date::text as due_date from tasks where source_task_id=$1",
              [child.rows[0].id],
            )
          ).rows[0].due_date,
          "2026-03-31",
        );
      },
    );
    await t.test(
      "manual ordering preserves RLS and rolls back a partially inaccessible batch",
      async () => {
        await as(bob);
        await db.query("select reorder_tasks($1::uuid[])", [[task]]);
        assert.equal(
          (
            await db.query<{ sort_order: number }>(
              "select sort_order from tasks where id=$1",
              [task],
            )
          ).rows[0].sort_order,
          0,
        );
        await assert.rejects(
          db.query("select reorder_tasks($1::uuid[])", [
            [task, "dddddddd-dddd-4ddd-8ddd-dddddddddddd"],
          ]),
          /access denied/,
        );
        await assert.rejects(
          db.query("update tasks set progress_target=0 where id=$1", [task]),
          /check constraint/,
        );
      },
    );
    await t.test(
      "third account cannot access shared data or invoke completion on it",
      async () => {
        await as(eve);
        assert.equal((await db.query("select * from tasks")).rows.length, 0);
        await assert.rejects(
          db.query("select set_task_status($1,'done')", [task]),
          /access denied/,
        );
        await assert.rejects(
          db.query("select share_list($1,$2)", [shared, "eve@example.com"]),
          /Only the owner/,
        );
      },
    );
    await t.test(
      "preferences are isolated and access revocation takes effect immediately",
      async () => {
        await as(alice);
        await db.query(
          'insert into preferences(user_id,settings) values($1,\'{"view":"calendar"}\')',
          [alice],
        );
        await as(bob);
        assert.equal(
          (await db.query("select * from preferences")).rows.length,
          0,
        );
        await assert.rejects(
          db.query(
            "insert into preferences(user_id,settings) values($1,'{}')",
            [alice],
          ),
          /row-level security/,
        );
        await as(alice);
        await db.query("select unshare_list($1,$2)", [shared, bob]);
        await as(bob);
        assert.equal((await db.query("select * from tasks")).rows.length, 0);
        assert.equal(
          (await db.query("delete from tasks where id=$1 returning id", [task]))
            .rows.length,
          0,
        );
        await as(alice);
        assert.equal((await db.query("select * from tasks")).rows.length, 4);
      },
    );
    await t.test(
      "cycles are private; cross-list goal tags enforce access and survive recurring actions",
      async () => {
        await as(alice);
        const goal = "dddddddd-dddd-4ddd-8ddd-dddddddddddd";
        const action = "eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee";
        await db.query(
          "insert into tasks(id,list_id,title,is_milestone) values ($1,$2,'Goal',true)",
          [goal, personal],
        );
        await db.query(
          "insert into planning_cycles(name,start_date,goal_ids) values ('Cycle','2026-11-02',array[$1::uuid])",
          [goal],
        );
        await db.query(
          "insert into tasks(id,list_id,title,goal_id,due_date,recurrence) values($1,$2,'Action',$3,'2026-11-02','weekly')",
          [action, personal, goal],
        );
        await assert.rejects(
          db.query("update tasks set is_milestone=false where id=$1", [goal]),
          /отвяжите/,
        );
        await db.query(
          "insert into tasks(list_id,title,goal_id) values($1,'Cross-list',$2)",
          [shared, goal],
        );
        await db.query("select set_task_status($1,'done')", [action]);
        assert.equal(
          (
            await db.query(
              "select goal_id from tasks where source_task_id=$1",
              [action],
            )
          ).rows[0].goal_id,
          goal,
        );
        await as(bob);
        assert.equal(
          (await db.query("select * from planning_cycles")).rows.length,
          0,
        );
        await assert.rejects(
          db.query(
            "insert into planning_cycles(owner_id,name,start_date) values($1,'Forged','2026-11-02')",
            [alice],
          ),
          /row-level security/,
        );
        await as(alice);
        await db.query("delete from tasks where id=$1", [goal]);
        assert.equal(
          (await db.query("select goal_id from tasks where id=$1", [action]))
            .rows[0].goal_id,
          null,
        );
        await db.exec("reset role; set role anon");
        await assert.rejects(
          db.query("select * from planning_cycles"),
          /permission denied/,
        );
      },
    );
    await t.test(
      "materialized recurrence batches are atomic, idempotent and RLS protected",
      async () => {
        await as(alice);
        const root = {
          ...makeTask(personal, alice, "2026-11-03"),
          title: "Daily all-day",
          recurrence: "daily" as const,
        };
        const expanded = saveRecurringTask([], root, "2026-11-03", alice).map(
          normalizeTask,
        );
        await db.query("select apply_task_changes($1::jsonb)", [
          JSON.stringify(expanded),
        ]);
        assert.equal(
          (await db.query("select id from tasks where series_id=$1", [root.id]))
            .rows.length,
          84,
        );
        await db.query("select apply_task_changes($1::jsonb)", [
          JSON.stringify(expanded),
        ]);
        await db.query("select set_task_status($1,'done')", [root.id]);
        assert.equal(
          (await db.query("select id from tasks where series_id=$1", [root.id]))
            .rows.length,
          84,
        );
        await as(bob);
        await assert.rejects(
          db.query("select apply_task_changes($1::jsonb)", [
            JSON.stringify([{ ...expanded[0], title: "Forbidden" }]),
          ]),
          /row-level security|duplicate key/,
        );
        const ownList = (
          await db.query("select id from lists where owner_id=$1", [bob])
        ).rows[0].id as string;
        const good = normalizeTask({
          ...makeTask(ownList, bob),
          title: "Must roll back",
        });
        await assert.rejects(
          db.query("select apply_task_changes($1::jsonb)", [
            JSON.stringify([good, { ...expanded[0], title: "Forbidden" }]),
          ]),
          /row-level security|duplicate key/,
        );
        assert.equal(
          (await db.query("select id from tasks where id=$1", [good.id])).rows
            .length,
          0,
        );
        await as(alice);
        const stopped = saveRecurringTask(
          expanded,
          { ...expanded[0], recurrence: "none" },
          "2026-11-03",
          alice,
        );
        const remove = expanded
          .filter((t) => !stopped.some((s) => s.id === t.id))
          .map((t) => t.id);
        // Retain the already completed root state when editing its rule.
        stopped[0].status = "done";
        stopped[0].completed_at = new Date().toISOString();
        await db.query("select apply_task_changes($1::jsonb,$2::uuid[])", [
          JSON.stringify(stopped.map(normalizeTask)),
          remove,
        ]);
        assert.equal(
          (await db.query("select id from tasks where series_id=$1", [root.id]))
            .rows.length,
          1,
        );
      },
    );
    await t.test(
      "financial books remain private even for shared-list members; revisions prevent stale writes",
      async () => {
        const book = JSON.stringify({
          version: 1,
          accounts: [],
          categories: [],
          transactions: [],
          templates: [],
          payments: [],
        });
        await as(alice);
        await db.query(
          "insert into finance_books(owner_id,revision,data) values ($1,1,$2::jsonb)",
          [alice, book],
        );
        await as(bob);
        assert.equal(
          (await db.query("select * from finance_books")).rows.length,
          0,
        );
        assert.equal(
          (
            await db.query(
              "update finance_books set revision=2 where owner_id=$1 returning owner_id",
              [alice],
            )
          ).rows.length,
          0,
        );
        await assert.rejects(
          db.query(
            "insert into finance_books(owner_id,revision,data) values ($1,1,$2::jsonb)",
            [alice, book],
          ),
          /row-level security/,
        );
        await db.exec("reset role; set role anon");
        await assert.rejects(
          db.query("select * from finance_books"),
          /permission denied/,
        );
        await as(alice);
        assert.equal(
          (
            await db.query(
              "update finance_books set revision=2 where owner_id=$1 and revision=1 returning revision",
              [alice],
            )
          ).rows.length,
          1,
        );
        assert.equal(
          (
            await db.query(
              "update finance_books set revision=2 where owner_id=$1 and revision=1 returning revision",
              [alice],
            )
          ).rows.length,
          0,
        );
        await assert.rejects(
          db.query("update finance_books set revision=8 where owner_id=$1", [
            alice,
          ]),
          /revision conflict/,
        );
        await assert.rejects(
          db.query("delete from finance_books where owner_id=$1", [alice]),
          /permission denied/,
        );
        await assert.rejects(
          db.query(
            "update finance_books set revision=3,data='{}'::jsonb where owner_id=$1",
            [alice],
          ),
          /check constraint/,
        );
      },
    );
    await t.test(
      "long-term goals are private and require sequential revisions",
      async () => {
        await as(alice);
        await db.query(
          "insert into long_goal_books(owner_id,revision,data) values ($1,1,$2::jsonb)",
          [alice, JSON.stringify({ version: 1, goals: [] })],
        );
        await as(bob);
        assert.equal(
          (await db.query("select * from long_goal_books")).rows.length,
          0,
        );
        await assert.rejects(
          db.query(
            "insert into long_goal_books(owner_id,revision,data) values ($1,1,$2::jsonb)",
            [alice, JSON.stringify({ version: 1, goals: [] })],
          ),
          /row-level security/,
        );
        await as(alice);
        assert.equal(
          (
            await db.query(
              "update long_goal_books set revision=2 where owner_id=$1 and revision=1 returning owner_id",
              [alice],
            )
          ).rows.length,
          1,
        );
        assert.equal(
          (
            await db.query(
              "update long_goal_books set revision=2 where owner_id=$1 and revision=1 returning owner_id",
              [alice],
            )
          ).rows.length,
          0,
        );
        await assert.rejects(
          db.query("update long_goal_books set revision=4 where owner_id=$1", [
            alice,
          ]),
          /revision conflict/,
        );
        await db.exec("reset role;set role anon");
        await assert.rejects(
          db.query("select * from long_goal_books"),
          /permission denied/,
        );
      },
    );
    await db.close();
  });
