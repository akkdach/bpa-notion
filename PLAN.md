# ProjectManagement — Self-hosted Notion clone

## Context

`d:/Projects/notion` is empty. We are building a **real multi-tenant product** — not a prototype — with a
block editor, nested pages, realtime collaboration, and full Notion-style database views.

Confirmed by the user:

| Decision | Choice |
|---|---|
| Backend | **ASP.NET Core `net10.0`** (user's explicit choice over Node) |
| Frontend | **React 19 + Vite + Tailwind v4 + Framer Motion (`motion`)** |
| Tenancy | **Multi-tenant, many workspaces** |
| Realtime | **From day one** — not deferred |
| DB views scope | **Everything**: Table / Board / Calendar / Gallery / List **+ formula engine** |
| Auth | **Email + password, hand-rolled JWT only.** No SSO, no email invites, no public share links |
| Name / namespace | **`ProjectManagement`** → `ProjectManagementAPI`, DB `projectmanagement`, containers `pm-api` / `pm-web` |

Because email invites and public share links were both declined:
- **No `workspace_invites` table, no SMTP dependency.** A workspace admin adds a member by typing the email
  of an already-registered user. Users self-register first.
- **No `page_shares` table, no `PublicShareService`.** This removes the only place tenant isolation would
  have had to be deliberately bypassed — a real security win, keep it that way.

Verified environment: .NET SDK `10.0.302` (+ ASP.NET runtime `10.0.10`), Node `v24.15.0`, npm `11.12.1`
(no pnpm/bun), Docker `29.2.1`. Not yet a git repo.

House conventions to follow (surveyed across ~15 existing projects in `d:/Projects`): PostgreSQL always,
hand-rolled JWT (`JWT_SECRET` / `JWT_EXPIRES_IN` + bcrypt), REST only (never GraphQL/tRPC), Tailwind v4 +
`clsx` + `tailwind-merge` + `lucide-react`, npm with no monorepo tooling, Docker Compose to self-hosted
on-prem, **English identifiers with Thai explanatory comments**, and `═══` / `───` comment banners.

---

## The five architectural decisions

### 1. Realtime: SignalR as an opaque binary relay

The server **never parses Yjs**. It is a durable pub/sub queue over an append-only `bytea` log.

This is correct, not merely convenient: Yjs updates are commutative, associative and idempotent, so a server
that guarantees only *"every update reaches every peer eventually, at least once"* is provably convergent.
Duplicate delivery is harmless — which is what makes the whole design collapse in complexity.

Rejected alternatives:
- **`Ycs`** (C# Yjs port) — last commit **2023-08-09**, 56 commits total, no NuGet package. A CRDT bug is
  silent unrecoverable data corruption. Not a foundation for a real product.
- **Node `y-websocket` sidecar** — the safe answer, and genuinely defensible. Rejected because it needs a
  *second implementation of your auth and per-page ACL logic in another language*, and duplicated permission
  logic drifts. It also drags Node back in after choosing .NET.

What we give up: the server can't read document content. Solved by decision 2.

### 2. Yjs is source of truth for page *bodies*; a client-pushed projection serves search

Strict one-way flow. 2s after the user stops typing, the client `POST`s
`{ title, plainText, outline, links[] }` derived from `editor.document`. The server writes `pages.title`,
`page_search`, `page_links`. This data is **derived** — if it's stale, search is stale; nothing corrupts.

The critical split: **a page body is a CRDT document; a database row's property values are
server-authoritative rows.** A row *is* a page (`kind='db_row'`), so its body is a Yjs doc like any other —
but its `properties` are plain JSONB mutated via REST `PATCH` with per-property merge, so two users editing
different columns never conflict. CRDT where you need character-level merge; transactions where you need
queryability.

### 3. Page tree: `parent_id` + maintained `ancestor_ids uuid[]`

Not `ltree` — its label charset excludes `-`, so UUIDs would need base32 encoding at every boundary.
`uuid[]` + GIN gives the same wins with none of that.

- Breadcrumbs: `WHERE id = ANY(ancestor_ids)`, one query, no recursion.
- Move a subtree of 500: **one `UPDATE`** over the GIN index (see DDL below).
- Cycle prevention: reject if `moved_id = ANY(new_parent.ancestor_ids)`.
- `parent_id` stays as the FK enforcing referential integrity; `ancestor_ids` is the read optimisation,
  rebuildable from `parent_id` via recursive CTE.

Sibling ordering: **fractional index `rank text`** (`fractional-indexing` client-side, ~90-line C# port
server-side). Integer `order` renumbers all siblings per insert and collides under concurrency.
`ORDER BY rank, id` everywhere for a deterministic tie-break; **do not** make `(parent_id, rank)` unique —
ranks legitimately collide.

### 4. Database views: JSONB per row, keyed by property **UUID**

EAV rejected: a 40-column × 50-row table view = 2000 rows to pivot, one join per filter condition, and the
wire format needs re-pivoting into objects anyway — a normalisation tax paid to produce a denormalised
payload.

Keyed by property UUID (not name) so renaming a column is a single-row `UPDATE` touching zero row data.

**Relations get their own table** (`database_row_relations`), deliberately not JSONB: rollups need
`JOIN`+aggregate, the "linked from" panel needs an index on the *target*, and dual properties need
bidirectional consistency in one transaction. All three are miserable through JSONB containment.

The load-bearing index is `(database_id, rank) WHERE database_id IS NOT NULL` — every view query filters
`database_id` first, collapsing the candidate set before any property predicate runs. Good to
**~50–100k rows per database**. Honest weakness: beyond that you need lazy per-property expression indexes,
and an index per (database × property) does not scale to thousands of user databases. The exit is a
per-database materialised projection table.

### 5. Formulas materialise into `pages.computed jsonb`

Since the user wants formulas **and** wants views to filter/sort/group, formula results must be visible to
Postgres — a read-time-only evaluator cannot be sorted on. So: evaluate server-side in C#, write into a
`computed jsonb` column, recompute when any dependency changes.

- Tokenizer → **Pratt parser** → AST → tree-walking evaluator (`api/Services/Formula/`).
- Dependency graph keyed by property UUID; **cycle detection via DFS on property add/edit**, rejected at
  save time with the offending cycle named.
- Invalidation: a `PATCH` to any row property recomputes that row's formulas + its rollups' parents.
  `rollup` recompute fans out through `database_row_relations`.
- Same materialisation applies to `rollup`, `created_time`, `last_edited_by` etc. — all read as `computed`.

This is the single biggest scope addition over a minimal build. Budget it separately (Phase 4c).

### Editor: BlockNote `0.52.1`, not raw Tiptap

BlockNote *is* Tiptap + ProseMirror underneath, so the `action-plan-frontend` Tiptap experience transfers
(`editor._tiptapEditor` is reachable for raw extensions). What ships for free and would otherwise be
hand-written: block drag handles with drop indicators, `/` slash menu, block/format toolbars, nested
indentation, markdown paste — and decisively
`withCollaboration({ provider, fragment, user, showCursorLabels })`, i.e. Yjs collab with rendered remote
carets and name labels. `@blocknote/shadcn` renders through **your** shadcn components, so the existing
`components.json` (`base-nova` / `neutral` / cssVariables) applies directly.

Costs, stated plainly:
- **0.x versioning — pin exact, no caret.** Budget half a day per minor bump.
- MPL-2.0 on core/react/shadcn: fine for closed self-hosted; file-level copyleft only triggers if you modify
  BlockNote's own files. **Extend, never vendor-patch** (patching also strands you on an old version).
- ⚠️ **`@blocknote/xl-multi-column`, `xl-docx-exporter`, `xl-ai` are `GPL-3.0 OR PROPRIETARY`** (verified via
  `npm view`). Multi-column layout and DOCX export are exactly what you'll want later. Buy the commercial
  licence or build them yourself — **do not `npm i` them casually.**

### Thai full-text search: PGroonga

`to_tsvector('simple', 'ผมชอบกินข้าวผัด')` yields one garbage token — Postgres's parser splits on whitespace
and Thai has none. Any plan shipping `tsvector` ships broken search for the primary content language.

`pg_trgm` is **not** the answer: it disables non-ASCII by default, needs a non-`C` UTF-8 ctype set at
initdb, has open reports of `invalid multibyte character` on 4-byte UTF-8, and gives fuzzy substring
matching with no relevance scoring or phrase queries. `pg_icu_parser` is linguistically correct but is a
PGXN source distribution you must recompile on every Postgres upgrade — a maintenance trap for on-prem.

**PGroonga** exists precisely for languages without word separators, and — verified — its official images
are built **on the official `postgres` image**, so `POSTGRES_PASSWORD` / `/docker-entrypoint-initdb.d` work
unchanged. Installation is a one-line `image:` swap. Confirmed tags: `4.0.6-debian-18`, `4.0.6-debian-17`,
`4.0.6-alpine-{17,18}`. PostgreSQL licence, active (4.0.6, Apr 2026). Gives real
`pgroonga_score()` relevance, `&@~` query syntax, and `pgroonga_snippet_html()` for result previews.

⚠️ Recall quality on Thai specifically is **unverified** — see Phase 6 verification.

### Multi-tenancy: shared schema + `workspace_id` + EF Core 10 **named** query filters

```csharp
// AppDbContext — must read an instance member so EF parameterises it
// (a captured constant gets baked into the cached compiled query)
public Guid? CurrentWorkspaceId => _tenant.WorkspaceId;

modelBuilder.Entity<Page>()
    .HasQueryFilter("Tenant",     p => p.WorkspaceId == CurrentWorkspaceId)
    .HasQueryFilter("SoftDelete", p => p.DeletedAt == null);
```

EF 10's named filters are why this is clean: the trash view calls `IgnoreQueryFilters(["SoftDelete"])` and
**keeps tenant isolation intact**. Pre-EF10, `IgnoreQueryFilters()` dropped everything at once — exactly how
tenant leaks ship. **A bare argument-less `IgnoreQueryFilters()` is a CI build failure** (grep gate).

Documented footguns to design around:
- **Filters don't apply to `FromSqlRaw`.** Search and view queries are raw SQL. Funnel every raw query
  through one `IScopedSql` helper that appends `WHERE workspace_id = @ws` from `ITenantContext`.
- **Required navigation + filter ⇒ `INNER JOIN` silently drops parents.** Configure cross-entity navs
  `.IsRequired(false)` or put matching filters on both ends.
- Filters are root-type only — no owned types, no derived types.
- `GET /me/workspaces` and login legitimately span tenants → route through a separate, deliberately
  unfiltered `IdentityQueries` service. Don't make the scoped tenant context do double duty.
- **In SignalR there is no `HttpContext`** — populate `TenantContext` from the JWT `workspace_id` claim
  inside the hub, not from middleware.

**Defence in depth at the DB layer** — this is what saves you when the C# has a bug. Every child table
carries `workspace_id` and its FK is **composite**:
`page_doc_updates (workspace_id, page_id) → pages (workspace_id, id)`. A cross-tenant reference becomes
*unrepresentable*, not merely unlikely. Cheap now, impossible to retrofit.

### Permissions resolved in one query via `pages.access_root_id`

Workspace roles `owner|admin|member|guest`; per-page `full|editor|commenter|viewer`.

A page either *inherits* (no `page_acl` rows) or *is an access root* (has rows, which stop inheritance).
`access_root_id` = nearest ancestor-or-self that is an access root:

```sql
SELECT a.role FROM pages p JOIN page_acl a ON a.page_id = p.access_root_id
WHERE p.id = $pageId
  AND ( (a.subject_type='user'  AND a.subject_id = $userId)
     OR (a.subject_type='group' AND a.subject_id = ANY($userGroupIds))
     OR  a.subject_type='workspace' )
ORDER BY array_position(ARRAY['full','editor','commenter','viewer'], a.role)
LIMIT 1;
```

One indexed query at constant depth regardless of a 20-level tree. Workspace `owner`/`admin` short-circuits
to `full` before the query runs. Semantics: **nearest-ancestor-wins** (Notion is additive; that's a later
refinement costing an `= ANY(ancestor_ids)` multi-row variant + in-memory max-role resolution).

`access_root_id` is maintained by three single-statement `UPDATE`s (first ACL added, last ACL removed, page
moved). Also denormalised onto `page_search` so search filters by `access_root_id = ANY($visibleRoots)` —
no per-hit permission check, no post-filtering that breaks `LIMIT`.

Caching: request-scoped memo is mandatory (a sidebar render asks ~50 times). `IMemoryCache` with 5s TTL is
safe; **never a long TTL with multiple API instances** — that's caching stale permissions per node.

---

## Repo layout

One git repo, two deployables as subfolders — matching `bpa-multi-agent/{frontend,backend}`, because
`docker-compose.yml` needs both build contexts and a schema change usually needs a matching UI change.
No monorepo tooling: npm lives only in `web/`, dotnet only in `api/`.

```
d:/Projects/notion/
├─ .gitignore  README.md
├─ docker-compose.yml            docker-compose.uat.yml
├─ .env  .env.uat  .env.production
├─ db/init/001_extensions.sql    # pgroonga, pgcrypto, citext
├─ api/                          # ASP.NET Core net10.0, namespace ProjectManagementAPI
└─ web/                          # Vite + React 19 SPA
```

---

# Engineering standards (mandatory)

`coffee-machine-management-api` already has `Repositories/`, `Helpers/`, `Middlewares/` and
`Configurations/` folders — **but they are all empty**, and `Services/` holds only `TokenService.cs`. The
layering was intended and never enforced. `action-plan-frontend` already has `components/ui/`, `service/`
and `page/<Feature>/`. This section makes both concrete and **CI-enforced**, keeping your existing
vocabulary (`service`, `page`) rather than inventing new terms.

These rules are not style preferences. This codebase will carry a CRDT relay, a formula engine, ~20 property
types and multi-tenant permission checks. Every one of those degrades into unmaintainable branching without
enforced boundaries.

## Backend — OOP, service-first, layered

```
api/
├─ Program.cs               # WIRING ONLY — zero business logic
├─ Configurations/          # AddPersistence() AddApplicationServices() AddAuth() AddRealtime() AddCors()
├─ Controllers/             # THIN: bind → validate → call service → map Result to ApiResponse
├─ Realtime/                # DocHub — also thin; a hub is a controller with a different transport
├─ Services/
│  ├─ Abstractions/         # IPageService, IPermissionService, IDatabaseService, IFormulaEvaluator…
│  ├─ PageService.cs  PermissionService.cs  DatabaseService.cs  ViewQueryService.cs
│  ├─ PropertyTypes/        # the strategy registry — see below
│  └─ Formula/              # Lexer.cs Parser.cs Ast.cs Evaluator.cs DependencyGraph.cs
├─ Repositories/
│  ├─ Abstractions/         # IPageRepository, IDocUpdateRepository, ISearchRepository…
│  └─ PageRepository.cs  DocUpdateRepository.cs  SearchRepository.cs
├─ Models/                  # EF Core entities (your existing convention — keep it)
├─ Domain/                  # value objects & domain rules: PropertyValue, Rank, FilterSpec, FormulaAst
├─ DTOs/                    # request/response records only
├─ Mapping/                 # explicit entity ↔ DTO. NO AutoMapper
├─ Data/                    # AppDbContext, TenantContext, IScopedSql, Migrations/
├─ Middlewares/  Filters/   # cross-cutting: tenant resolution, exception filter, validation filter
└─ Helpers/                 # ApiResponse<T>, Result<T>
```

**The eight rules, each with the reason it exists:**

1. **Every service has an interface**, registered `AddScoped<IPageService, PageService>()`. Not ceremony —
   the tenant-isolation test suite and the formula unit tests both need substitution, and without interfaces
   you cannot write them.
2. **Controllers and `DocHub` never touch `AppDbContext`.** ⚙️ *CI gate:* grep for `AppDbContext` or
   `DbSet` under `Controllers/` or `Realtime/` fails the build. This is the rule that keeps tenant filters
   and permission checks from being bypassed by a convenient inline query.
3. **`Repositories/` is the only place `AppDbContext` appears** — plus `IScopedSql` for the raw-SQL paths
   (PGroonga search, view queries). One boundary means one place to audit for `workspace_id`.
4. **`Result<T>` for expected failures; exceptions only for bugs.** "Page not found", "rank collision",
   "formula cycle detected" are outcomes, not exceptions. Controllers map `Result` → HTTP status **once**, in
   one helper. Exceptions-as-control-flow in a hot path (`PushUpdate` runs per keystroke) is also a real
   performance problem.
5. **DTOs at the boundary; entities never cross it.** Explicit hand-written mapping in `Mapping/`.
   **No AutoMapper** — it silently maps `WorkspaceId` and `PasswordHash` onto response objects, and its
   failures are runtime, not compile-time. In a multi-tenant app that is a data-leak generator.
6. **SOLID where it earns its keep, not everywhere:**
   - *SRP* — one service per aggregate (`PageService`, `DatabaseService`, `PermissionService`). If a service
     exceeds ~300 lines it has two responsibilities.
   - *OCP* — **the property-type strategy below.** This is the single highest-value OOP decision in the
     project.
   - *DIP* — services depend on `IXxxRepository`, never on EF Core types. Keeps EF out of business logic and
     out of unit tests.
7. **`Program.cs` is wiring only.** Extension methods live in `Configurations/`. The coffee template's
   `Program.cs` is the shape to copy (same `═══` banners), but every `services.Add…` block moves into an
   extension method once it exceeds a few lines.
8. **`async` all the way down, `CancellationToken` on every IO-touching method.** A user navigating away
   mid-view-query must not leave a 10k-row scan running. Validation via a single filter, never scattered
   through controller bodies.

### The one place OOP genuinely pays off: property-type strategies

Phase 4 has ~20 property types, each needing distinct write-normalisation, validation, SQL filter
generation, SQL sort generation, and (for rollup/formula) computation. Written as `switch` statements that
is five parallel 20-arm switches that must be kept in sync — guaranteed rot.

```csharp
public interface IPropertyTypeHandler
{
    string Type { get; }                                             // "select", "relation", …
    JsonNode? Normalize(JsonNode? raw, PropertyConfig cfg);          // write path
    ValidationResult Validate(JsonNode? value, PropertyConfig cfg);
    SqlFragment BuildFilter(FilterCondition c, SqlParams p);         // read path
    SqlFragment BuildSort(Guid propertyId, SortDirection dir);
    JsonNode? Compute(RowContext ctx, PropertyConfig cfg);           // rollup/formula only
}
```

Registered as `IEnumerable<IPropertyTypeHandler>` and resolved through an
`IPropertyTypeRegistry` keyed on `Type`. **Adding a property type becomes one new class and zero changes
anywhere else** — and each handler is independently unit-testable, which is the only realistic way to get
20 types × 5 behaviours correct. Sort handlers are also where the Thai `COLLATE "th-TH-x-icu"` rule lives,
in exactly one place.

## Frontend — component-first

```
web/src/
├─ components/
│  ├─ ui/            # shadcn primitives. DUMB. zero app knowledge, zero feature imports
│  ├─ common/        # composed but app-agnostic: DataTable, EmptyState, ConfirmDialog, Skeleton
│  └─ layout/        # AppShell, SidebarChrome, Topbar
├─ features/<domain>/            # auth, workspace, pages, editor, database, search
│  ├─ components/    # domain presentational components
│  ├─ hooks/         # use*.ts — React Query + local state. THE ONLY place data is fetched
│  ├─ service/       # API calls only. THE ONLY place axios appears  (your existing convention)
│  ├─ types.ts
│  └─ index.ts       # barrel — the ONLY public surface of the feature
├─ page/             # route-level composition only, no logic   (your existing naming)
├─ realtime/         # SignalRProvider, hubConnection
└─ lib/              # cn(), apiClient, queryClient
```

**The seven rules:**

1. **A component takes data through props and reports out through callbacks. It never fetches.** This is
   what "component-first" means operationally, and it is what makes a component reusable, storybook-able,
   and testable without a server.
2. **Data lives in `hooks/`, HTTP lives in `service/`.** `hooks/` may import `service/`; `service/` imports
   only `lib/apiClient`. A component importing axios is a bug.
3. **Dependency direction is one-way:**
   `page → features → components/common → components/ui → lib`.
   Never upward. Never sideways between features — cross-feature use goes through the other feature's
   `index.ts` barrel, or the shared piece gets promoted into `components/common`.
   ⚙️ *CI gate:* `eslint-plugin-boundaries` (or `import/no-restricted-paths`) enforces this. Without a
   linter this rule is decoration.
4. **`components/ui/*` must be copy-pasteable into an unrelated project.** Zero imports from `features/`,
   `page/`, or `service/`. That's the invariant that makes the layer real and it's mechanically checkable.
5. **One component per file**, named export matching the filename, `interface XxxProps` colocated directly
   above it. No default exports (they break rename-refactors and make barrels ambiguous).
6. **No hardcoded colours, spacing, or radii** — Tailwind tokens and the shadcn CSS variables only. This is
   what makes dark mode in Phase 8 a config change instead of a rewrite.
7. **Animation is a prop, not a wrapper habit.** `motion` belongs in `components/` where the visual lives;
   features and hooks stay animation-agnostic. Otherwise Phase 8's polish pass has to touch business logic.

### Definition of done for any feature

Backend: interface + implementation + DI registration + DTOs + explicit mapping + `Result<T>` error paths +
`CancellationToken` + a tenant-isolation test row added to the `[Theory]` route table.
Frontend: presentational component with typed props + a hook that owns fetching + a `service/` function +
barrel export + loading/empty/error states + keyboard reachable.

⚙️ **CI gates in total** (all are cheap grep/lint rules, all catch a class of bug that code review misses):
bare `IgnoreQueryFilters()` outside `IdentityQueries.cs`; `AppDbContext`/`DbSet` under
`Controllers/` or `Realtime/`; axios imported outside `service/`; cross-feature or upward imports;
`components/ui/` importing app code.

---

## Core schema

```sql
-- ═══════════ identity & tenancy ═══════════
users(id uuid pk default gen_random_uuid(), email citext unique not null,
      password_hash text not null, name text, avatar_url text,
      locale text default 'th', created_at timestamptz default now(), last_login_at timestamptz)

workspaces(id uuid pk, slug text unique not null, name text not null, icon text,
           created_by uuid references users, created_at timestamptz, deleted_at timestamptz)

workspace_members(workspace_id uuid, user_id uuid,
                  role text not null check (role in ('owner','admin','member','guest')),
                  joined_at timestamptz, primary key (workspace_id, user_id))
  -- + index (user_id)   ← "my workspaces"

refresh_tokens(id uuid pk, user_id uuid, token_hash text not null,
               expires_at timestamptz, revoked_at timestamptz, user_agent text, ip inet)

-- ═══════════ page tree — database rows ARE pages ═══════════
pages(
  id             uuid primary key default gen_random_uuid(),
  workspace_id   uuid not null references workspaces,
  parent_id      uuid,
  ancestor_ids   uuid[] not null default '{}',    -- root..parent
  depth          int    not null default 0,
  rank           text   not null,                 -- fractional index
  kind           text   not null check (kind in ('page','database','db_row')),
  database_id    uuid,                            -- non-null ⇔ kind='db_row'
  title          text   not null default '',      -- projection from Yjs
  icon text, cover_url text,
  properties     jsonb  not null default '{}',    -- db_row values, keyed by property UUID
  computed       jsonb  not null default '{}',    -- materialised formula/rollup results
  access_root_id uuid   not null,
  archived_at timestamptz, deleted_at timestamptz,
  created_by uuid, last_edited_by uuid,
  created_at timestamptz default now(), updated_at timestamptz default now(),
  unique (workspace_id, id),                                       -- enables composite FKs
  foreign key (workspace_id, parent_id) references pages (workspace_id, id)
);
create index on pages (workspace_id, parent_id, rank)
  where deleted_at is null and database_id is null;   -- sidebar tree
create index on pages using gin (ancestor_ids);       -- subtree ops
create index on pages (workspace_id, access_root_id);
create index on pages (database_id, rank)
  where database_id is not null and deleted_at is null;            -- ← load-bearing
create index on pages using gin (properties jsonb_path_ops)
  where database_id is not null and deleted_at is null;
create index on pages using gin (computed jsonb_path_ops)
  where database_id is not null and deleted_at is null;

-- move a subtree of any size: ONE statement
-- UPDATE pages SET ancestor_ids = $new_prefix || ancestor_ids[$old_depth+1 : ],
--                  depth = depth + ($new_depth - $old_depth)
--  WHERE workspace_id = $ws AND ancestor_ids @> ARRAY[$moved_id]::uuid[];

-- ═══════════ Yjs storage ═══════════
page_doc_updates(
  seq bigint generated always as identity primary key,
  workspace_id uuid not null, page_id uuid not null,
  update bytea not null, y_client_id bigint, author_user_id uuid,
  created_at timestamptz not null default now(),
  foreign key (workspace_id, page_id) references pages (workspace_id, id) on delete cascade
);
create index on page_doc_updates (page_id, seq);    -- the only access path

page_doc_snapshots(
  id bigint generated always as identity primary key,
  workspace_id uuid not null, page_id uuid not null,
  snapshot bytea not null, up_to_seq bigint not null, byte_size int not null,
  created_by uuid, created_at timestamptz default now(),
  foreign key (workspace_id, page_id) references pages (workspace_id, id) on delete cascade
);
create unique index on page_doc_snapshots (page_id, up_to_seq);
create index on page_doc_snapshots (page_id, up_to_seq desc);

-- ═══════════ user-defined databases ═══════════
databases(id uuid pk, workspace_id uuid not null, page_id uuid not null,
          name text not null, description text, is_inline boolean default false,
          created_at timestamptz, updated_at timestamptz)

database_properties(
  id uuid primary key,          -- THE JSONB KEY. never reused, never renamed.
  workspace_id uuid not null, database_id uuid not null references databases,
  name text not null,
  type text not null,           -- title|text|number|select|multi_select|status|date|checkbox|
                                -- person|url|email|phone|files|relation|rollup|formula|
                                -- created_time|created_by|last_edited_time|last_edited_by|unique_id
  config jsonb not null default '{}',
    -- select/status : {"options":[{"id":…,"name":…,"color":…}],"groups":[…]}
    -- number        : {"format":"number|percent|thb","precision":2}
    -- date          : {"includeTime":true,"tz":"Asia/Bangkok"}
    -- relation      : {"targetDatabaseId":…,"dualPropertyId":…,"multiple":true}
    -- rollup        : {"relationPropertyId":…,"targetPropertyId":…,"function":"sum|count|…"}
    -- formula       : {"expression":"prop(\"a\") + 1","deps":[…property uuids…]}
  rank text not null, is_deleted boolean default false
);
create unique index on database_properties (database_id, lower(name)) where not is_deleted;

database_row_relations(               -- deliberately NOT inside JSONB
  workspace_id uuid not null,
  property_id uuid not null references database_properties,
  from_row_id uuid not null, to_row_id uuid not null, rank text not null,
  primary key (property_id, from_row_id, to_row_id)
);
create index on database_row_relations (property_id, to_row_id);  -- dual/reverse
create index on database_row_relations (to_row_id);               -- "linked from"

database_views(
  id uuid pk, workspace_id uuid, database_id uuid not null references databases,
  name text, type text check (type in ('table','board','calendar','list','gallery')),
  rank text,
  filter jsonb not null default '{"op":"and","conditions":[]}',
  sorts jsonb not null default '[]',
  group_by jsonb, visible_properties jsonb,
  calendar_property_id uuid, page_size int default 50,
  created_by uuid, created_at timestamptz, updated_at timestamptz
);
database_view_row_ranks(view_id uuid, row_id uuid, rank text,
                        primary key (view_id, row_id));   -- sparse per-view manual order

-- ═══════════ permissions ═══════════
page_acl(page_id uuid, subject_type text check (subject_type in ('user','group','workspace')),
         subject_id uuid, role text not null check (role in ('full','editor','commenter','viewer')),
         granted_by uuid, granted_at timestamptz,
         primary key (page_id, subject_type, subject_id));

-- ═══════════ search ═══════════
page_search(
  page_id uuid primary key references pages(id) on delete cascade,
  workspace_id uuid not null, access_root_id uuid not null, database_id uuid,
  title text not null default '', body_text text not null default '',
  search_text text generated always as (title || ' ' || body_text) stored,
  updated_at timestamptz not null default now()
);
-- ⚠️ tokenizer ต้องระบุเสมอ — ยืนยันด้วยการทดลองจริงใน Phase 0 (ดูด้านล่าง)
--    ถ้าไม่ระบุ PGroonga จะตัดคำด้วยช่องว่างแล้วทำ prefix match ซึ่งกับภาษาไทย
--    ที่ไม่มีช่องว่างระหว่างคำ = ค้นเจอเฉพาะคำที่อยู่ต้น "ก้อน" เท่านั้น
create index page_search_body_pgrn on page_search using pgroonga (search_text)
  with (tokenizer = 'TokenNgram("n", 2, "unify_alphabet", false)');
create index page_search_title_pgrn on page_search using pgroonga (title)   -- title boost
  with (tokenizer = 'TokenNgram("n", 2, "unify_alphabet", false)');
create index page_search_scope on page_search (workspace_id, access_root_id);
```

**Canonical JSONB value encoding** — write it down once, version it (`properties` carries `"_v": 1`):

| type | encoding |
|---|---|
| `text` `url` `email` `phone` | `"…"` |
| `number` | `123.45` |
| `checkbox` | `true` |
| `date` | `{"start":"2026-07-25","end":null,"time":false}` |
| `select` `status` | `"<option_id>"` |
| `multi_select` | `["<option_id>", …]` |
| `person` | `["<user_uuid>", …]` |
| `files` | `[{"id":…,"name":…,"url":…}]` |
| `relation` | **absent** → `database_row_relations` |
| `rollup` `formula` `created_*` `last_edited_*` | **absent** → `pages.computed` |

Two Thai-specific details: sort text with `ORDER BY (properties->>'p_x') COLLATE "th-TH-x-icu"` (built in,
no extension — byte order puts Thai vowel marks in nonsense positions), and `properties->>'x'` on a missing
key is `NULL`, so pin `NULLS LAST` explicitly or `DESC` will surprise you.

**Raw SQL, not EF migrations**, for: PGroonga indexes, the `search_text` generated column, GIN on `uuid[]`
and `jsonb_path_ops`, and all partial indexes. Put them in `api/Migrations/Sql/*.sql` invoked via
`migrationBuilder.Sql(...)` — EF cannot express them.

---

## Realtime contract

`api/Realtime/DocHub.cs` mapped at `/hubs/doc`, **MessagePack protocol** so `byte[]` goes over the wire raw
instead of base64 (~33% saving on the hottest path).

```csharp
public interface IDocClient {
    Task ReceiveUpdate(Guid pageId, byte[] update, long seq);
    Task ReceiveAwareness(Guid pageId, byte[] awarenessUpdate);
    Task StateRequested(Guid pageId, string fromConnectionId, byte[] stateVector);
    Task PeerLeft(Guid pageId, long yClientId);
    Task AccessRevoked(Guid pageId);
    Task CompactionRequested(Guid pageId);
}

[Authorize] public class DocHub : Hub<IDocClient> {
    Task<JoinDocResult> JoinDocument(Guid pageId);   // authz → AddToGroup → metadata. NO doc bytes.
    Task LeaveDocument(Guid pageId);
    Task PushUpdate(Guid pageId, byte[] update);     // broadcast now, persist batched
    Task PushAwareness(Guid pageId, byte[] awarenessUpdate);  // never persisted
    Task RequestState(Guid pageId, byte[] stateVector);       // relayed blindly
    Task ReplyState(Guid pageId, string targetConnectionId, byte[] diff);
}

public record JoinDocResult(Guid PageId, string Role, long HeadSeq, long SnapshotUpToSeq,
                           int UpdatesSinceSnapshot, bool ShouldCompact, string BootstrapUrl);
```

**Bootstrap — race-free by construction:**
1. Open hub connection (JWT attached).
2. `await hub.invoke("JoinDocument", pageId)` — authorize, **then** `AddToGroupAsync`, **then** return
   metadata. From that instant SignalR queues every subsequent update to this connection.
3. `GET /api/v1/pages/{id}/ydoc` → `application/octet-stream`, length-prefixed frames
   `[u32 count][u32 len][bytes]…`, frame 0 = snapshot, frames 1..n = `page_doc_updates` in `seq` order,
   read in one `REPEATABLE READ` transaction.
4. `Y.applyUpdate(doc, frame)` per frame.
5. Broadcast `RequestState(Y.encodeStateVector(doc))`; live peers reply with
   `Y.encodeStateAsUpdate(doc, sv)` — closes the gap for anything not yet flushed to the DB.

Updates arriving between 2 and 4 are delivered twice. **Harmless — that is the entire point.**

> **Bootstrap over REST, not the hub.** SignalR's `MaximumReceiveMessageSize` defaults to **32 KB** and a
> reconnecting offline client pushes full state far larger. Set `4 * 1024 * 1024` on `MapHub` *and* route
> snapshot upload via `POST`.

**Awareness / presence:** a `y-protocols/awareness` instance owned by our provider →
`encodeAwarenessUpdate` → `PushAwareness` → group broadcast, **never touches Postgres**. Local state carries
`{ user: { id, name, color, avatarUrl } }`. `OnDisconnectedAsync` broadcasts `PeerLeft` per joined page;
awareness's own 30s timeout covers server crashes. BlockNote's `collaboration.user` + `showCursorLabels`
renders carets and labels for free.

**Auth on the channel:** browsers can't set WebSocket headers, so use the documented query-param pattern —
`JwtBearerEvents.OnMessageReceived` reads `access_token` when the path starts with `/hubs`; client passes
`accessTokenFactory`. `[Authorize]` gives connection identity; `JoinDocument` calls
`IPermissionService.GetEffectiveRoleAsync` and throws `HubException("forbidden")` on null. Cache the granted
role in `Context.Items[$"page:{pageId}"]` so `PushUpdate` checks **in memory** — no DB hit on the hot path.
`Context.Items` also holds `WorkspaceId` from the JWT; every hub method asserts
`page.WorkspaceId == that`. Revocation: `CloseOnAuthenticationExpiration = true` so the connection dies at
token `exp` and silently reconnects, plus `AccessRevoked` broadcast on ACL change.

**Reconnect / offline:** `y-indexeddb` for instant cold-open and offline accumulation. On reconnect the
provider sends **one** `PushUpdate(Y.encodeStateAsUpdate(doc))` — fat but correct and idempotent.
`withAutomaticReconnect([0, 2000, 5000, 10000, 30000])` **plus an `onreconnected` handler that re-runs
`JoinDocument` for every open doc — group membership is lost on reconnect and this is the #1 bug people
hit.**

**Write batching — do not skip.** y-prosemirror emits ~1 update/keystroke ≈ 10 rows/sec/user.
- *Client:* buffer 200ms → `Y.mergeUpdates(buffer)` → send one. ~10× fewer rows, zero server complexity.
- *Server:* `PushUpdate` broadcasts **immediately** (latency), then writes to a
  `Channel<PendingUpdate>`; `YUpdateWriter : BackgroundService` drains every 200ms into one multi-row
  `INSERT` (`NpgsqlBinaryImporter` COPY above ~50 rows).
- Accepted caveat: a ≤200ms at-most-once persistence window. Every connected peer already has the update and
  re-pushes full state on reconnect, and `y-indexeddb` holds a client-side copy.

**Client-assisted compaction, with guards.** Server elects one client (lowest Yjs `clientID`) via
`ShouldCompact` when `UpdatesSinceSnapshot > 300`. That client `POST`s `Y.encodeStateAsUpdate(doc)` with
`upToSeq`. Server, in one transaction: insert the snapshot, then prune only what the **second-newest**
snapshot already covers (one generation of slack), then keep the newest 3 snapshots.
Guards, because a client can lie: require `editor`+; reject `upToSeq > head_seq`; if
`byte_size < 0.5 ×` previous, **store but skip the prune** and warn. Accepted failure mode: a page nobody
reopens never compacts — in practice a long log means an actively edited page.

---

## Phases

Effort assumes **one developer full-time with AI assistance**. Roughly halve wall-clock with two.

| # | Phase | Effort | Demoable outcome |
|---|---|---|---|
| **0** | Scaffolding, infra **& the CI gates** | **3–4 d** | `docker compose up` → Postgres+PGroonga, API Swagger, web shell, health green. **Layer folders created empty, `eslint-plugin-boundaries` configured, all grep gates wired into CI and failing on a deliberate violation** |
| **1** | **Walking skeleton** | **1.5–2 wk** | Register → login → create workspace → nested pages in a sidebar → type in BlockNote → refresh → **content still there.** Single-user, autosave via the update log |
| **2** | Realtime collab | **1.5–2 wk** | Two browsers, live character sync, remote cursors with names, avatar stack, offline reconcile |
| **3** | Editor & tree depth | **2 wk** | Slash menu, all block types, drag-reorder blocks *and* sidebar pages, `@page` mentions, breadcrumbs, icons/covers, duplicate/move/trash |
| **4a** | **Databases: table + board** | **4–5 wk** | Typed properties, inline editing, filter/sort/group builder UI, kanban drag-between-columns, relations + rollups |
| **4b** | Calendar / gallery / list views | **2–3 wk** | Calendar with drag-to-reschedule, gallery cards, list view, per-view manual row order |
| **4c** | **Formula engine** | **2 wk** | Pratt parser + evaluator + dependency graph + cycle detection, materialised into `computed`, filterable/sortable |
| **5** | Permissions | **1.5 wk** | Add members by email, workspace roles, per-page share dialog with inheritance display, guest access |
| **6** | Thai search & discovery | **1 wk** | ⌘K quick-find over Thai content with highlighted snippets, backlinks, "linked from" |
| **7** | Files, comments, history | **2–3 wk** | Upload, inline comment threads, page version history (the update log is already there — mostly UI), trash restore |
| **8** | Polish | **2 wk** | Framer Motion throughout (sidebar, page transitions, modal springs, drag previews, skeletons), dark mode, keyboard shortcuts, responsive |
| **9** | Production hardening | **2 wk** | Redis SignalR backplane, rate limiting, audit log, backups, structured logging, rank renormalisation + snapshot GC |

**≈ 6–6.5 months solo** — Phase 4 alone (4a+4b+4c ≈ 8–10 weeks) is bigger than most complete CRUD apps.
Be honest with yourself about that number before starting.

Sequencing rationale: realtime is Phase 2 **not** Phase 8, because retrofitting CRDT into an editor that
assumed single-writer autosave means rewriting the editor. Databases come after the editor because rows
*are* pages and depend on the tree working. Permissions come after databases because the ACL surface must
cover both.

---

## Phase 0 + 1 files

### `api/` — adapt from `d:/Projects/coffee-machine-management-api/` (verified present: `Program.cs`, `Services/TokenService.cs`, `Controllers/HealthCheckController.cs`)

| File | Purpose / provenance |
|---|---|
| `api/ProjectManagementAPI.csproj` | **Copy `CoffeeManagemantAPI.csproj` verbatim**, bump versions, add packages below |
| `api/Program.cs` | **Copy the coffee template's structure** — same `═══`/`───` banners, same section order. **Wiring only**; each block delegates to a `Configurations/` extension method |
| `api/Configurations/` | `PersistenceConfiguration.cs` (`UseNpgsql` + `UseSnakeCaseNamingConvention`), `AuthConfiguration.cs` (JwtBearer + `OnMessageReceived` for `/hubs`), `RealtimeConfiguration.cs` (`AddSignalR().AddMessagePackProtocol()`, `MaximumReceiveMessageSize = 4MB`, `AddHostedService<YUpdateWriter>()`), `ApplicationServicesConfiguration.cs` (all `AddScoped<IXxx, Xxx>()` + the property-type registry), `CorsConfiguration.cs` (`WithOrigins(...).AllowCredentials()`, **never** `AllowAll`) |
| `api/appsettings{,.Development}.json` | Same shape as the template. **Read secrets from env in Docker** — the template hardcodes a live DB password in source; do not repeat that |
| `api/Dockerfile` | `mcr.microsoft.com/dotnet/sdk:10.0` build → `aspnet:10.0` runtime, non-root, `EXPOSE 8080` |
| `api/Data/AppDbContext.cs` | DbSets, named query filters, composite unique/FK, `jsonb` + `uuid[]` mappings |
| `api/Data/ITenantContext.cs` `TenantContext.cs` | Scoped: `WorkspaceId`, `UserId`, `WorkspaceRole` |
| `api/Data/IdentityQueries.cs` | The deliberately tenant-unfiltered path (login, my-workspaces) |
| `api/Data/IScopedSql.cs` | Raw-SQL wrapper that always appends `workspace_id = @ws` |
| `api/Middlewares/TenantResolutionMiddleware.cs` | `workspace_id` claim / `X-Workspace-Id` header → `TenantContext`, verifies membership |
| `api/Models/` | EF entities: `User`, `Workspace`, `WorkspaceMember`, `RefreshToken`, `Page`, `PageAcl`, `PageDocUpdate`, `PageDocSnapshot`, `PageSearch` |
| `api/Domain/` | `Rank.cs` (value object wrapping the fractional index), `PropertyValue.cs`, `EffectiveRole.cs` |
| `api/DTOs/` | `AuthDto.cs`, `WorkspaceDto.cs`, `PageDto.cs`, `YDocDto.cs` — records, boundary only |
| `api/Mapping/` | `PageMapping.cs`, `WorkspaceMapping.cs` — explicit extension methods. **No AutoMapper** |
| `api/Repositories/Abstractions/` | `IPageRepository`, `IDocUpdateRepository`, `IWorkspaceRepository`, `IUserRepository` |
| `api/Repositories/` | Implementations — **the only files allowed to reference `AppDbContext`** |
| `api/Services/Abstractions/` | `ITokenService`, `IPasswordHasher`, `IPermissionService`, `IPageTreeService` |
| `api/Services/TokenService.cs` | **Copy the coffee one**; add `workspace_id` + `role` claims and refresh-token issue/rotate. Extract an `ITokenService` interface (the template has none) |
| `api/Services/PasswordHasher.cs` | `BCrypt.Net.BCrypt.EnhancedHashPassword`, workFactor 12 |
| `api/Services/PermissionService.cs` | One-query effective-role resolver + request-scoped memo |
| `api/Services/PageTreeService.cs` | `ancestor_ids` / `depth` / `access_root_id` maintenance, move, duplicate, **plus `RebuildAncestorIds` and `RecomputeAccessRoots` repair routines — write these in Phase 1, you will run them while debugging** |
| `api/Services/FractionalIndex.cs` | ~90-line C# port of `generateKeyBetween` |
| `api/Realtime/DocHub.cs` `IDocClient.cs` `JoinDocResult.cs` | The contract above. **Thin — delegates to services exactly like a controller** |
| `api/Realtime/YUpdateWriter.cs` | `BackgroundService` + `Channel<PendingUpdate>` → batched INSERT |
| `api/Controllers/` | `AuthController`, `WorkspacesController`, `PagesController`, `PageDocumentsController` (bootstrap GET / snapshot POST / projection POST), `HealthCheckController` (**copy the coffee one**). **No `AppDbContext` anywhere** |
| `api/Filters/` | `ValidationFilter.cs`, `ApiExceptionFilter.cs` — validation and error shaping in one place, not in controller bodies |
| `api/Helpers/ApiResponse.cs` `Result.cs` | Uniform envelope + the `Result<T>` type all services return |
| `api/Migrations/` + `Migrations/Sql/` | `dotnet ef migrations add InitialCreate` + the raw-SQL index files |

### `web/` — adapt from `d:/Projects/action-plan-frontend/` (verified present: `vite.config.ts`, `components.json`, `nginx.conf`, `Dockerfile`)

| File | Purpose / provenance |
|---|---|
| `web/vite.config.ts` | **Copy verbatim** — `react()`, `tailwindcss()`, `@` → `./src` |
| `web/components.json` | **Copy verbatim** (`base-nova`, `neutral`, cssVariables, `@/components/ui`) |
| `web/nginx.conf` | **Copy, then ADD** `location /api/` and `location /hubs/` `proxy_pass` blocks with `proxy_http_version 1.1` + `Upgrade`/`Connection` headers + `proxy_read_timeout 3600s`. **Without the upgrade headers WebSockets silently fall back to long-polling and collab feels broken** |
| `web/Dockerfile` | **Copy** (node:22-alpine build → nginx:stable-alpine); replace hardcoded `ENV VITE_*` with `ARG`s |
| `web/package.json` | Same `env-cmd` script pattern (`start`, `start:uat`, `build:prod`) |
| `web/src/index.css` | Tailwind v4 `@import "tailwindcss"` + shadcn vars + `tw-animate-css` + `@blocknote/shadcn/style.css` |
| `web/src/lib/utils.ts` | `cn()` = `clsx` + `twMerge`. Copy |
| `web/src/lib/apiClient.ts` | Axios instance, `VITE_API_BASE_URL`, bearer interceptor, 401 → refresh → retry. **The only file `service/` imports** |
| `web/src/lib/queryClient.ts` | TanStack Query client + default retry/staleTime policy |
| `web/src/components/ui/` | shadcn primitives via `npx shadcn@4 add …`. Zero app imports |
| `web/src/components/common/` | `EmptyState`, `ConfirmDialog`, `Skeleton`, `ErrorBoundary` |
| `web/src/components/layout/` | `AppShell`, `SidebarChrome`, `Topbar` |
| `web/src/features/auth/` | `service/authApi.ts` · `hooks/useAuth.ts` · `components/LoginForm.tsx` `RegisterForm.tsx` · `AuthProvider.tsx` · `index.ts` |
| `web/src/features/workspace/` | `service/workspaceApi.ts` · `hooks/useWorkspaces.ts` · `components/WorkspaceSwitcher.tsx` `CreateWorkspaceDialog.tsx` · `index.ts` |
| `web/src/features/pages/` | `service/pageApi.ts` · `hooks/usePageTree.ts` `useMovePage.ts` · `components/PageTree.tsx` `PageTreeItem.tsx` `Breadcrumbs.tsx` · `index.ts` |
| `web/src/features/editor/` | `components/PageEditor.tsx` (`useCreateBlockNote` + `BlockNoteView` from `@blocknote/shadcn`) · `hooks/useYDoc.ts` (Y.Doc lifecycle, `IndexeddbPersistence`, provider wiring, projection debounce) · `service/projectionApi.ts` |
| `web/src/page/` | `LoginPage.tsx`, `WorkspacePage.tsx`, `PageView.tsx` — route composition only, no logic |
| **`web/src/realtime/SignalRProvider.ts`** | **The keystone file.** Yjs provider over SignalR: exposes `.awareness`, join → bootstrap fetch → `RequestState`, 200ms `Y.mergeUpdates` outbound batching, reconnect re-join, compaction upload |
| `web/src/realtime/hubConnection.ts` | Shared `HubConnectionBuilder` — `accessTokenFactory`, msgpack, `withAutomaticReconnect` |
| `web/.env{,.uat,.production}` | `VITE_API_BASE_URL`, `VITE_HUB_URL` |

---

## Packages (versions verified against nuget.org / npm)

### NuGet — `net10.0`

```xml
<PackageReference Include="Microsoft.AspNetCore.Authentication.JwtBearer" Version="10.0.10" />
<PackageReference Include="Microsoft.AspNetCore.OpenApi"                  Version="10.0.10" />
<PackageReference Include="Microsoft.EntityFrameworkCore.Design"          Version="10.0.10" /> <!-- PrivateAssets -->
<PackageReference Include="Microsoft.EntityFrameworkCore.Tools"           Version="10.0.10" /> <!-- PrivateAssets -->
<PackageReference Include="Npgsql.EntityFrameworkCore.PostgreSQL"         Version="10.0.3"  />
<PackageReference Include="Swashbuckle.AspNetCore"                        Version="10.2.3"  />
<PackageReference Include="Microsoft.AspNetCore.SignalR.Protocols.MessagePack" Version="10.0.10" />
<PackageReference Include="BCrypt.Net-Next"                              Version="4.2.1"   />
<PackageReference Include="EFCore.NamingConventions"                     Version="10.0.1"  />
<PackageReference Include="FluentValidation.DependencyInjectionExtensions" Version="12.1.1" />
<!-- tests --><PackageReference Include="Testcontainers.PostgreSql"      Version="4.13.0"  />
<!-- Phase 9 --><!-- Microsoft.AspNetCore.SignalR.StackExchangeRedis 10.0.10 -->
```

SignalR *server* needs no package (in-framework); only the MessagePack protocol does.
Use `JsonDocument`/`JsonElement` for `jsonb` and hand-serialise — property values are dynamic anyway, and
that avoids needing Npgsql's `.EnableDynamicJson()`.

Use `FluentValidation.DependencyInjectionExtensions` (12.1.1) with the `ValidationFilter`, **not**
`FluentValidation.AspNetCore` (stuck at 11.3.1) — the maintainers no longer recommend its auto-validation
integration, and an explicit filter is what the standards section requires anyway.

### npm — `web/`

```jsonc
"react": "^19.2.0", "react-dom": "^19.2.0", "react-router-dom": "^7.13.0",
"@tanstack/react-query": "^5.101.4", "axios": "^1.13.5",

"tailwindcss": "^4.1.18", "@tailwindcss/vite": "^4.1.18", "tw-animate-css": "^1.4.0",
"clsx": "^2.1.1", "tailwind-merge": "^3.6.0", "class-variance-authority": "^0.7.1",
"lucide-react": "^1.14.0", "@base-ui/react": "^1.5.0",

"motion": "^12.42.2",                       // the current package name for Framer Motion

"@blocknote/core": "0.52.1",                // PIN EXACT — 0.x breaks on minors
"@blocknote/react": "0.52.1", "@blocknote/shadcn": "0.52.1",

"yjs": "^13.6.31", "y-protocols": "^1.0.7", "y-indexeddb": "^9.0.12",
"@microsoft/signalr": "^10.0.0", "@microsoft/signalr-protocol-msgpack": "^10.0.0",

"fractional-indexing": "^4.0.0",
"@dnd-kit/core": "^6.3.1", "@dnd-kit/sortable": "^10.0.0", "@dnd-kit/utilities": "^3.2.2",
"date-fns": "^4.4.0", "sonner": "^2.0.7",

// dev — mirror action-plan-frontend
"vite": "^7.3.1", "@vitejs/plugin-react": "^5.1.1", "typescript": "~5.9.3",
"env-cmd": "^11.0.0", "shadcn": "^4.7.0", "@playwright/test": "^1.62.0",
"eslint-plugin-boundaries": "^7.1.0"    // enforces the layer rules — without it they're decoration
```

**Deliberate deviations from house convention, flagged:**
- **`@tanstack/react-query`** — not in your portfolio (you use axios directly). Recommended anyway: page
  trees, view state, filter/sort, and realtime invalidation is where hand-rolled fetch state grows bugs, and
  `invalidateQueries` is the natural target for SignalR change notifications.
- **`@blocknote/*` over raw `@tiptap/*`** — argued above; Tiptap is still underneath and reachable.
- **xUnit + Playwright** — you have no test tooling anywhere. For a product with real users and a CRDT,
  "two browsers agree" and "tenant A cannot read tenant B" must be automated, not eyeballed.
- ⚠️ **Never install** `@blocknote/xl-multi-column`, `xl-docx-exporter`, `xl-ai` — `GPL-3.0 OR PROPRIETARY`.

---

## docker-compose.yml

```yaml
# no top-level `version:` — obsolete in Compose v2 (your Docker 29.2.1) and emits a warning
name: projectmanagement

services:
  postgres:
    image: groonga/pgroonga:4.0.6-debian-18       # official postgres base + pgroonga (verified)
    container_name: pm-postgres
    restart: always
    environment:
      POSTGRES_DB: ${POSTGRES_DB:-projectmanagement}
      POSTGRES_USER: ${POSTGRES_USER:-postgres}
      POSTGRES_PASSWORD: ${POSTGRES_PASSWORD}
      # ⚠️ set at initdb — CANNOT be changed later without dump/restore
      POSTGRES_INITDB_ARGS: "--locale-provider=icu --icu-locale=th-TH --encoding=UTF8"
    volumes:
      - pgdata:/var/lib/postgresql/data
      - ./db/init:/docker-entrypoint-initdb.d:ro
    ports: ["5432:5432"]                          # dev only — remove in production
    healthcheck:
      test: ["CMD-SHELL", "pg_isready -U ${POSTGRES_USER:-postgres} -d ${POSTGRES_DB:-projectmanagement}"]
      interval: 10s
      retries: 10
    networks: [app-network]

  api:
    build: { context: ./api, dockerfile: Dockerfile }
    container_name: pm-api
    restart: always
    environment:
      ASPNETCORE_ENVIRONMENT: ${ASPNETCORE_ENVIRONMENT:-Production}
      ASPNETCORE_HTTP_PORTS: 8080
      ConnectionStrings__DefaultConnection: >-
        Host=postgres;Port=5432;Database=${POSTGRES_DB:-projectmanagement};
        Username=${POSTGRES_USER:-postgres};Password=${POSTGRES_PASSWORD};Include Error Detail=true
      JWT_SECRET: ${JWT_SECRET}
      JWT_EXPIRES_IN: ${JWT_EXPIRES_IN:-24h}
      Cors__AllowedOrigins__0: ${WEB_ORIGIN:-http://localhost}
      Uploads__RootPath: /app/uploads
    volumes: [uploads:/app/uploads]
    depends_on: { postgres: { condition: service_healthy } }
    ports: ["5080:8080"]
    networks: [app-network]

  web:
    build:
      context: ./web
      args:
        VITE_API_BASE_URL: ${VITE_API_BASE_URL:-/api/v1}    # same-origin via nginx proxy
        VITE_HUB_URL: ${VITE_HUB_URL:-/hubs/doc}
    container_name: pm-web
    restart: always
    depends_on: [api]
    ports: ["80:80"]
    networks: [app-network]

  db-backup:                                       # on-prem has no managed snapshots
    image: prodrigestivill/postgres-backup-local:18 # tag verified to exist
    restart: always
    environment:
      POSTGRES_HOST: postgres
      POSTGRES_DB: ${POSTGRES_DB:-projectmanagement}
      POSTGRES_USER: ${POSTGRES_USER:-postgres}
      POSTGRES_PASSWORD: ${POSTGRES_PASSWORD}
      SCHEDULE: "@daily"
      BACKUP_KEEP_DAYS: 14
      BACKUP_KEEP_WEEKS: 8
    volumes: [./backups:/backups]
    depends_on: { postgres: { condition: service_healthy } }
    networks: [app-network]

volumes: { pgdata: {}, uploads: {} }
networks: { app-network: { driver: bridge } }
```

**Notably absent: any Node service** — that is the payoff of the SignalR-relay decision.

`web` (nginx) reverse-proxies `/api` and `/hubs` to `api`, so the browser sees **one origin**. This
eliminates CORS entirely, sidesteps the `AllowAnyOrigin` + `AllowCredentials` runtime conflict that SignalR
would otherwise trigger, and lets refresh-token cookies be `SameSite=Strict`.

---

## Verification

**Phase 0** — `docker compose up -d` clean; `psql -c "SELECT extname FROM pg_extension"` shows `pgroonga`;
`GET /api/v1/health` returns 200 with a DB round-trip; `http://localhost` serves the SPA and a deep link
like `/workspace/x/page/y` doesn't 404 (proves nginx SPA fallback).

**Then prove every CI gate actually fires** — commit a deliberate violation of each, one at a time, and
confirm the build goes red: a `DbSet` reference in a controller; an `import axios` inside a component; a
`features/pages` file importing `features/editor` directly instead of via its barrel; a
`components/ui/button.tsx` importing from `features/`; a bare `IgnoreQueryFilters()`. **A gate you have
never seen fail is a gate you cannot trust.** Revert the violations after.

**Phase 1**
- Register → login → JWT decodes with `sub`, `workspace_id`, `role`.
- Create 3-deep nesting; assert `ancestor_ids`, `depth`, `access_root_id` in psql.
- **Move test:** script 500 descendants, move the root, `EXPLAIN ANALYZE` shows one `UPDATE`, all 500
  `ancestor_ids` correct.
- **Repair test:** deliberately corrupt `ancestor_ids`, run `RebuildAncestorIds`, assert convergence.
- Type → `page_doc_updates` grows → hard refresh → identical content. Then
  `DELETE FROM page_doc_snapshots` and reload — still correct (proves log replay).
- **Ordering:** two concurrent inserts at the same sibling slot → identical ranks → `ORDER BY rank, id`
  gives both clients the same order.

**Phase 2 — how to actually test collab**
- *Manual:* **two Chrome profiles, not two tabs** (tabs share IndexedDB and mask bugs). Type in both at
  once, watch cursors. DevTools → Network → **Offline** on one, type in both, back online, assert
  convergence with no lost characters. Then kill the API container mid-edit and confirm reconnect +
  convergence.
- *Playwright:* two `browser.newContext()` → two independent storage states → concurrent `type()` → poll
  until `A.textContent() === B.textContent()` → assert the expected merge. Then `setOffline(true)` on B,
  type in both, `setOffline(false)`, assert convergence. **Then load a third context and assert it sees the
  same text — this is the test that catches broken persistence, and the one people forget.**
- *CRDT fuzz:* a node script driving three headless Y.Docs through the real provider with randomised
  concurrent ops for 60s, asserting `Y.encodeStateAsUpdate` equality. Cheap; catches relay-ordering bugs
  manual testing never will.
- *Compaction:* generate 400 updates, assert a snapshot appears and rows prune to the second-newest
  boundary, then bootstrap a fresh client and assert identical content. **Then POST a deliberately
  truncated snapshot and assert the guard refuses to prune.**
- *Realtime auth:* no token → rejected. Valid token, `JoinDocument` on another workspace's page →
  `HubException`. Revoke ACL mid-session → `AccessRevoked` and subsequent `PushUpdate` refused.

**Tenant isolation — a permanent CI gate, not a one-time check**
- xUnit + `Testcontainers.PostgreSql`: seed workspaces A and B. **For every GET/PATCH/DELETE endpoint taking
  an id**, call it with A's token and B's page id → assert **404, not 403** (don't leak existence). Drive it
  from a `[Theory]` over a route table **so new endpoints fail the test until explicitly listed** — this is
  what catches the endpoint someone adds in month four without thinking about tenancy.
- Grep gate: any bare argument-less `IgnoreQueryFilters()` outside `IdentityQueries.cs` fails the build.
- Insert a `page_doc_update` with mismatched `(workspace_id, page_id)` → assert the **composite FK** rejects
  it, proving the DB backstop is live.

**Phase 4** — seed a 10k-row database; `EXPLAIN ANALYZE` a view query with 3 filters + a sort, assert it
uses `pages (database_id, rank)` and p95 < 200ms. Filter on every property type. Concurrently `PATCH` two
different properties of the same row from two clients and assert both survive (proves the JSONB merge).
For 4c: unit-test the parser against a fixture table of expressions, and assert a self-referencing formula
is rejected at save time with the cycle named.

**Phase 6 — PGroonga on Thai: ✅ VERIFIED in Phase 0, and the finding changed the design.**

This was the plan's biggest unknown, so it was tested against `groonga/pgroonga:4.0.6-debian-18` before
anything was built on top of it. Result: **PGroonga works correctly on Thai — but only if the tokenizer is
declared explicitly. The default is silently broken for Thai.**

With a plain `USING pgroonga (search_text)` index, searching a 5-row Thai corpus gave:

| query | expected | default tokenizer | explicit bigram |
|---|---|---|---|
| `ข้าวผัด` | row 1 | ❌ 0 rows | ✅ row 1 |
| `กระเพรา` | row 1 | ❌ 0 rows | ✅ row 1 |
| `ไก่` | rows 1, 3 | ❌ 0 rows | ✅ rows 1, 3 |
| `ผัด` | rows 1, 5 | — | ✅ rows 1, 5 |
| `ยอดขาย` | row 2 | ✅ row 2 | ✅ row 2 |
| `chicken` | row 3 | ✅ row 3 | ✅ row 3 |
| `sprint` | row 4 | ✅ row 4 | ✅ row 4 |
| `กระเพรา ไก่` (AND) | row 1 | — | ✅ row 1 |
| `รถยนต์` (over-match probe) | 0 | ✅ 0 | ✅ 0 |

The default tokenizer splits on **whitespace** and then prefix-matches. Thai has no whitespace between
words, so a whole Thai clause becomes one token and only queries that happen to be a *prefix* of that token
match. That is why `ยอดขาย` "worked" — it is a prefix of `ยอดขายเครื่องดื่มเพิ่มขึ้น` — while `ข้าวผัด`
(mid-token) returned nothing. **A test corpus that happened to use prefix terms would have passed and shipped
broken search.**

The fix is one clause, and it is now mandatory on every PGroonga index in this project:

```sql
WITH (tokenizer = 'TokenNgram("n", 2, "unify_alphabet", false)')
```

Also confirmed: relevance scoring via `pgroonga_score(tableoid, ctid)` and
`pgroonga_snippet_html(body, pgroonga_query_extract_keywords(...))` both work on Thai (the snippet correctly
wrapped `ผัดกระเพรา`), and `EXPLAIN` shows a real `Index Scan`, not a filtered seq scan.

Two corrections to earlier assumptions: `pgroonga_tokenize` is `(text, VARIADIC text[]) -> json[]` and needs
at least one option argument (`VARIADIC ARRAY[]::text[]` for none); and `TokenBigram` bigrams Latin runs too
rather than keeping them as whole words — harmless, since English queries still resolve correctly.

Changing `tokenizer=` later requires a `REINDEX`, so it is set from the first migration.

Remaining Phase 6 work: insert ~2,000 realistic Thai pages and compare recall against a `LIKE '%…%'`
baseline at that scale, and confirm bigram index size is acceptable on long documents.
**Meilisearch stays the contingency** if recall disappoints at volume — the projection endpoint is already
the single write point to fan out from, so it is a contained swap, not a redesign. Do *not* reach for
Elasticsearch on an on-prem VM.

---

## Risks — where this will actually hurt

1. **Phase 4 is ~40% of the product.** Filter builder UI, group-by with drag-between-groups, calendar
   drag-to-reschedule, relation pickers with search, rollup recalculation, per-view manual order, and now a
   formula engine are each multi-day features. Notion's database views are a spreadsheet application. **This
   is where the schedule dies.** If time pressure arrives, cut 4b (calendar/gallery/list) before 4a.
2. **SignalR group membership is lost on reconnect.** Miss the `onreconnected` re-join and collab works in
   testing then silently dies in production after the first network blip. Write that test in Phase 2.
3. **The 32 KB `MaximumReceiveMessageSize` default.** An offline client's full-state push exceeds it.
   Symptom: opaque connection close, only for users who went offline — i.e. never in your testing.
4. **CORS + SignalR credentials.** `AllowAnyOrigin()` throws at runtime the moment you add
   `AllowCredentials()`, which SignalR needs. The single-origin nginx proxy sidesteps this — but if `web` and
   `api` ever run on different hosts you must switch to explicit `WithOrigins`.
5. **BlockNote is 0.x.** Pin exact. Read the changelog before every bump. Accept that you'll hit a
   limitation whose fix is upstream — reach into `editor._tiptapEditor` rather than forking.
6. **Update-log write volume.** Without both batching layers, 20 concurrent editors generate ~200 small
   INSERT/s and autovacuum becomes the bottleneck long before CPU. `page_doc_updates` will be your largest
   table by row count; consider `PARTITION BY HASH (page_id)` past ~50M rows.
7. **Client-assisted compaction is a trust boundary.** A merely *buggy* client can write a lossy snapshot.
   The 3-snapshot retention + one generation of slack + size-shrink guard make it *recoverable*, not
   *impossible*. Keep the `created_by` audit trail. If it ever bites, the planned pivot is a Node compactor
   sidecar as an offline batch job — know that in advance so it's a decision, not a crisis.
8. **`access_root_id` drift is a permission bug** — the worst kind. Three maintenance paths each with a bug
   budget. Run `RecomputeAccessRoots` as a nightly consistency check that alerts on mismatch for the first
   few months. The composite FKs keep any drift a within-workspace over-share, never a cross-tenant leak.
9. **JSONB has a real ceiling** — excellent to 50k rows/database, questionable at 500k. You're choosing
   "excellent at realistic scale, awkward at unrealistic scale" over EAV's "mediocre everywhere." The exit is
   a per-database materialised projection table.
10. **Thai text at the edges.** ICU collation is irreversible after initdb. And because Thai has no word
    boundaries, `lang="th"` + CSS `word-break` / `line-break: loose` matter for the editor to wrap
    readably — a small thing that makes the product feel wrong if missed.
11. **The layering will be the first thing abandoned under deadline pressure.** Your existing
    `coffee-machine-management-api` is the evidence: `Repositories/`, `Helpers/`, `Middlewares/` and
    `Configurations/` all exist and all are empty. Folders are not a standard; **the CI gates are the
    standard**, which is why they belong in Phase 0 rather than Phase 9. The specific temptation to expect is
    a one-line `_db.Pages.Where(...)` inside a controller at 2am in Phase 4 — that is exactly the query that
    skips the tenant filter and the permission check. Let the build stop you.
12. **PGroonga's default tokenizer silently breaks Thai search** — *confirmed in Phase 0, not theoretical.*
    Every PGroonga index **must** carry `WITH (tokenizer = 'TokenNgram("n", 2, "unify_alphabet", false)')`.
    Without it, whitespace tokenization + prefix matching means a query only matches when it happens to be a
    prefix of a whole Thai clause. The trap: a test corpus built from prefix terms passes, so the bug reaches
    production. Changing the tokenizer later needs a full `REINDEX`. See the Phase 6 verification table.
13. **~6 months solo is the honest number**, with the block editor bought off the shelf. If that's not the
    budget, the ruthless cut is Phases 0–3 + 5 + 6 (≈9 weeks): a genuinely good collaborative nested-page
    wiki with Thai search and proper multi-tenant permissions, no databases. That ships as a real product on
    its own and beats a half-built database view.

### Resolved in Phase 0 (was "still to verify")

- ✅ **PGroonga tokenizer for Thai** — `TokenNgram("n", 2, "unify_alphabet", false)`, and it is
  **mandatory**: the default tokenizer silently returns nothing for mid-token Thai queries. Full evidence in
  the Phase 6 verification section above. This is now Risk #13.
- ✅ **`groonga/pgroonga:4.0.6-debian-18` works.** `pgroonga 4.0.6` / `pgcrypto 1.4` / `citext 1.8` install
  cleanly from `/docker-entrypoint-initdb.d`, server reports `18.3 (Debian 18.3-1.pgdg13+1)`. No need to
  fall back to PG 17.
- ✅ **`POSTGRES_INITDB_ARGS` ICU locale takes effect** — `datlocprovider=i`, `datlocale=th-TH`. Thai
  dictionary ordering verified against byte order: ICU gives `กระเพรา · เก้าอี้ · ไก่ · ข้าวผัด · โต๊ะ`
  (correct — leading vowels reorder under their consonant) versus `C` collation's
  `กระเพรา · ข้าวผัด · เก้าอี้ · โต๊ะ · ไก่`.
- ⚠️ **PostgreSQL 18 changed the data-directory convention** — mount the volume at
  `/var/lib/postgresql`, **not** `/var/lib/postgresql/data`. With the old mount point the 18+ entrypoint
  **refuses to start** (long error, not a warning) because data now lives in a major-version subdirectory so
  that `pg_upgrade --link` works across mount boundaries. Every pre-18 compose example on the internet has
  the old path.

### Still to verify during the build
- `HttpConnectionDispatcherOptions.CloseOnAuthenticationExpiration` name/placement on .NET 10 (Phase 2).
- PGroonga bigram index size and recall at ~2,000+ real Thai pages (Phase 6) — small-corpus correctness is
  proven, volume behaviour is not.
- Whether the 4 MB `MaximumReceiveMessageSize` is actually enough for a full-state push from a long offline
  session (Phase 2).

---

# Appendix A — Full folder structure

Phase tags mark when a folder first appears. Create only what the current phase needs — but create the
**empty layer folders in Phase 0** so there is never a moment where "there's nowhere to put this" justifies
putting it in a controller.

## `api/` — ASP.NET Core `net10.0`, namespace `ProjectManagementAPI`

```
api/
├─ ProjectManagementAPI.csproj
├─ Program.cs                          # wiring only
├─ appsettings.json  appsettings.Development.json
├─ Dockerfile  .dockerignore
├─ Properties/launchSettings.json
│
├─ Configurations/                     # every services.Add… block lives here
│   ├─ PersistenceConfiguration.cs         # UseNpgsql + UseSnakeCaseNamingConvention
│   ├─ AuthConfiguration.cs                # JwtBearer + OnMessageReceived for /hubs
│   ├─ RealtimeConfiguration.cs            # AddSignalR().AddMessagePackProtocol(), 4MB limit
│   ├─ ApplicationServicesConfiguration.cs # all AddScoped<IXxx,Xxx>() + property-type registry
│   ├─ CorsConfiguration.cs                # WithOrigins().AllowCredentials() — never AllowAll
│   └─ SwaggerConfiguration.cs
│
├─ Controllers/                        # thin. NO AppDbContext (CI-enforced)
│   ├─ HealthCheckController.cs            # P0  ← copy from coffee template
│   ├─ AuthController.cs                   # P1
│   ├─ WorkspacesController.cs             # P1
│   ├─ WorkspaceMembersController.cs       # P5
│   ├─ PagesController.cs                  # P1
│   ├─ PageDocumentsController.cs          # P1  ydoc bootstrap / snapshot / projection
│   ├─ PageAclController.cs                # P5
│   ├─ DatabasesController.cs              # P4a
│   ├─ DatabasePropertiesController.cs     # P4a
│   ├─ DatabaseRowsController.cs           # P4a
│   ├─ DatabaseViewsController.cs          # P4a
│   ├─ SearchController.cs                 # P6
│   ├─ FilesController.cs                  # P7
│   └─ CommentsController.cs               # P7
│
├─ Realtime/                           # a hub is a controller with a different transport
│   ├─ DocHub.cs  IDocClient.cs  JoinDocResult.cs      # P2
│   ├─ YUpdateWriter.cs  PendingUpdate.cs              # P2  BackgroundService + Channel
│   └─ ChangeNotifier.cs                               # P4  pushes row changes → invalidateQueries
│
├─ Services/
│   ├─ Abstractions/                   # ITokenService IPasswordHasher IPermissionService
│   │                                  # IPageService IPageTreeService IDocumentService
│   │                                  # IProjectionService IDatabaseService IViewQueryService
│   │                                  # IRollupService IFormulaEvaluator ISearchService
│   ├─ TokenService.cs  PasswordHasher.cs              # P1
│   ├─ PermissionService.cs                            # P1 (one-query resolver) → P5 (full ACL)
│   ├─ PageService.cs  PageTreeService.cs              # P1  + the two repair routines
│   ├─ FractionalIndex.cs                              # P1  generateKeyBetween port
│   ├─ DocumentService.cs  ProjectionService.cs        # P1–P2  snapshot & compaction policy
│   ├─ DatabaseService.cs  ViewQueryService.cs         # P4a  ViewQueryService builds the SQL
│   ├─ RollupService.cs                                # P4a
│   ├─ SearchService.cs                                # P6
│   ├─ PropertyTypes/                  # P4a — the strategy registry (OCP)
│   │   ├─ IPropertyTypeHandler.cs  IPropertyTypeRegistry.cs  PropertyTypeRegistry.cs
│   │   ├─ TextPropertyHandler.cs  NumberPropertyHandler.cs  CheckboxPropertyHandler.cs
│   │   ├─ SelectPropertyHandler.cs  MultiSelectPropertyHandler.cs  StatusPropertyHandler.cs
│   │   ├─ DatePropertyHandler.cs  PersonPropertyHandler.cs  FilesPropertyHandler.cs
│   │   ├─ UrlPropertyHandler.cs  EmailPropertyHandler.cs  PhonePropertyHandler.cs
│   │   ├─ RelationPropertyHandler.cs  RollupPropertyHandler.cs                 # P4a
│   │   ├─ FormulaPropertyHandler.cs                                            # P4c
│   │   └─ SystemPropertyHandlers.cs   # created_time/by, last_edited_time/by, unique_id
│   └─ Formula/                        # P4c
│       ├─ Lexer.cs  Token.cs  Parser.cs (Pratt)  Ast.cs
│       ├─ Evaluator.cs  FunctionRegistry.cs
│       └─ DependencyGraph.cs          # topological order + DFS cycle detection
│
├─ Repositories/                       # THE ONLY place AppDbContext appears
│   ├─ Abstractions/                   # IUserRepository IWorkspaceRepository IPageRepository
│   │                                  # IPageAclRepository IDocUpdateRepository
│   │                                  # IDatabaseRepository IRowRelationRepository
│   │                                  # ISearchRepository
│   ├─ UserRepository.cs  WorkspaceRepository.cs  PageRepository.cs          # P1
│   ├─ DocUpdateRepository.cs                          # P2  only NpgsqlBinaryImporter user
│   ├─ PageAclRepository.cs                            # P5
│   ├─ DatabaseRepository.cs  RowRelationRepository.cs  # P4a
│   └─ SearchRepository.cs                             # P6  raw SQL + PGroonga &@~
│
├─ Data/
│   ├─ AppDbContext.cs                 # named query filters, composite FKs, jsonb/uuid[] maps
│   ├─ ITenantContext.cs  TenantContext.cs
│   ├─ IdentityQueries.cs              # the deliberately tenant-unfiltered path
│   ├─ IScopedSql.cs  ScopedSql.cs     # every raw query gets WHERE workspace_id = @ws
│   ├─ DbSeeder.cs
│   └─ Migrations/
│       ├─ …_InitialCreate.cs
│       └─ Sql/                        # what EF migrations cannot express
│           ├─ 001_pgroonga_indexes.sql
│           ├─ 002_gin_and_partial_indexes.sql
│           └─ 003_generated_columns.sql
│
├─ Models/          # EF entities: User Workspace WorkspaceMember RefreshToken Page PageAcl
│                   #   PageDocUpdate PageDocSnapshot PageSearch PageLink
│                   #   Database DatabaseProperty DatabaseView DatabaseRowRelation Comment FileAsset
├─ Domain/          # value objects: Rank PropertyValue EffectiveRole FilterSpec SortSpec
├─ DTOs/            # AuthDto WorkspaceDto PageDto YDocDto DatabaseDto RowDto ViewDto SearchDto
├─ Mapping/         # PageMapping WorkspaceMapping DatabaseMapping — explicit, no AutoMapper
├─ Validators/      # FluentValidation, one per request DTO
├─ Filters/         # ValidationFilter  ApiExceptionFilter
├─ Middlewares/     # TenantResolutionMiddleware  RequestLoggingMiddleware
└─ Helpers/         # ApiResponse<T>  Result<T>  PagedResult<T>

tests/ProjectManagementAPI.Tests/      # P0 skeleton, filled from P1
├─ ProjectManagementAPI.Tests.csproj   # xunit + Mvc.Testing + Testcontainers.PostgreSql
├─ Fixtures/PostgresFixture.cs  ApiFactory.cs
├─ TenantIsolation/RouteTableTests.cs  # the [Theory] gate — new endpoints fail until listed
├─ Services/PageTreeServiceTests.cs  PermissionServiceTests.cs  FractionalIndexTests.cs
├─ PropertyTypes/…HandlerTests.cs      # one file per handler
└─ Formula/ParserTests.cs  EvaluatorTests.cs  CycleDetectionTests.cs
```

## `web/` — Vite + React 19 SPA

```
web/
├─ package.json  vite.config.ts  index.html
├─ tsconfig.json  tsconfig.app.json  tsconfig.node.json
├─ eslint.config.js                    # + eslint-plugin-boundaries layer rules
├─ components.json                     # copy from action-plan-frontend verbatim
├─ nginx.conf  Dockerfile  .dockerignore
├─ .env  .env.uat  .env.production
├─ playwright.config.ts
├─ e2e/                                # P2 onward
│   ├─ collab-two-context.spec.ts          # the two-browser convergence test
│   ├─ collab-offline.spec.ts
│   ├─ tenant-isolation.spec.ts
│   └─ page-crud.spec.ts
├─ public/
└─ src/
    ├─ main.tsx  App.tsx  routes.tsx  index.css  vite-env.d.ts
    │
    ├─ lib/                            # leaf layer — imports nothing from above
    │   ├─ apiClient.ts                    # axios + interceptors. ONLY service/ imports this
    │   ├─ queryClient.ts  utils.ts (cn)  constants.ts
    │   └─ format.ts                       # Thai date/number/currency
    │
    ├─ components/
    │   ├─ ui/                         # shadcn primitives. ZERO app imports (CI-enforced)
    │   │   └─ button input dialog dropdown-menu popover select tooltip tabs
    │   │      checkbox badge avatar calendar command sheet scroll-area …
    │   ├─ common/                     # composed but app-agnostic
    │   │   ├─ EmptyState.tsx  ConfirmDialog.tsx  ErrorBoundary.tsx
    │   │   ├─ LoadingSkeleton.tsx  IconPicker.tsx  ColorSwatch.tsx
    │   │   ├─ SortableList.tsx             # dnd-kit wrapper
    │   │   └─ VirtualList.tsx              # P4 — table view needs windowing
    │   └─ layout/
    │       ├─ AppShell.tsx  SidebarChrome.tsx  Topbar.tsx  ResizeHandle.tsx
    │
    ├─ features/                       # each: service/ hooks/ components/ types.ts index.ts
    │   ├─ auth/                       # P1
    │   │   ├─ service/authApi.ts
    │   │   ├─ hooks/useAuth.ts  useLogin.ts  useRegister.ts
    │   │   ├─ components/LoginForm.tsx  RegisterForm.tsx
    │   │   ├─ AuthProvider.tsx  types.ts  index.ts
    │   ├─ workspace/                  # P1 → P5
    │   │   ├─ service/workspaceApi.ts  memberApi.ts
    │   │   ├─ hooks/useWorkspaces.ts  useMembers.ts
    │   │   ├─ components/WorkspaceSwitcher.tsx  CreateWorkspaceDialog.tsx
    │   │   │              MemberList.tsx  AddMemberDialog.tsx  RoleSelect.tsx
    │   │   └─ index.ts
    │   ├─ pages/                      # P1 → P3
    │   │   ├─ service/pageApi.ts
    │   │   ├─ hooks/usePageTree.ts  usePage.ts  useCreatePage.ts  useMovePage.ts
    │   │   ├─ components/PageTree.tsx  PageTreeItem.tsx  Breadcrumbs.tsx
    │   │   │              PageHeader.tsx  PageIcon.tsx  CoverImage.tsx  TrashDialog.tsx
    │   │   └─ index.ts
    │   ├─ editor/                     # P1 → P3
    │   │   ├─ service/docApi.ts  projectionApi.ts
    │   │   ├─ hooks/useYDoc.ts  useProjection.ts  usePresence.ts
    │   │   ├─ components/PageEditor.tsx  PresenceAvatars.tsx
    │   │   │              blocks/          # custom BlockNote block types
    │   │   │              mentions/PageMention.tsx  MentionMenu.tsx
    │   │   ├─ schema.ts                    # BlockNote schema definition
    │   │   └─ index.ts
    │   ├─ database/                   # P4 — by far the largest feature
    │   │   ├─ service/databaseApi.ts  rowApi.ts  viewApi.ts  propertyApi.ts
    │   │   ├─ hooks/useDatabase.ts  useRows.ts  useViewConfig.ts  useRowMutation.ts
    │   │   │        useProperties.ts
    │   │   ├─ components/
    │   │   │   ├─ DatabaseContainer.tsx  ViewTabs.tsx
    │   │   │   ├─ table/     TableView TableRow TableHeaderCell ColumnResizer RowActions
    │   │   │   ├─ board/     BoardView BoardColumn BoardCard          # P4a
    │   │   │   ├─ calendar/  CalendarView CalendarCell                # P4b
    │   │   │   ├─ gallery/   GalleryView GalleryCard                  # P4b
    │   │   │   ├─ list/      ListView                                 # P4b
    │   │   │   ├─ cells/     TextCell NumberCell SelectCell MultiSelectCell DateCell
    │   │   │   │             CheckboxCell PersonCell FilesCell RelationCell
    │   │   │   │             RollupCell FormulaCell                    # one per property type
    │   │   │   ├─ toolbar/   FilterBuilder SortBuilder GroupBySelect PropertyVisibility
    │   │   │   └─ property/  PropertyEditor PropertyTypeSelect SelectOptionEditor
    │   │   │                 RelationConfig RollupConfig FormulaInput  # P4c
    │   │   ├─ propertyRegistry.ts          # client mirror of the server strategy
    │   │   └─ index.ts
    │   ├─ permissions/                # P5  service/aclApi · hooks/useAcl · ShareDialog
    │   │                              #     PermissionRow  InheritanceBadge
    │   ├─ search/                     # P6  QuickFind (⌘K)  SearchResultItem  BacklinksPanel
    │   ├─ comments/                   # P7  CommentThread  CommentInput  CommentAnchor
    │   └─ history/                    # P7  VersionTimeline  VersionDiff
    │
    ├─ page/                           # route composition ONLY — no logic
    │   ├─ LoginPage.tsx  RegisterPage.tsx
    │   ├─ WorkspaceLayout.tsx  PageView.tsx  DatabaseView.tsx
    │   ├─ TrashPage.tsx  SettingsPage.tsx  NotFoundPage.tsx
    │
    ├─ realtime/                       # P2
    │   ├─ SignalRProvider.ts               # ★ the keystone file
    │   ├─ hubConnection.ts  awareness.ts  types.ts
    │
    └─ store/
        └─ uiStore.ts                       # zustand: sidebar width, collapsed nodes, theme
```

**Two notes on the frontend tree.**

`components/ui/` is the only folder copied wholesale from an existing project — everything else is written.
And `store/uiStore.ts` is **UI state only** (sidebar width, which tree nodes are expanded, theme). Server
data belongs in React Query and document data belongs in the Y.Doc; putting either into zustand creates a
third source of truth that will disagree with the other two. `zustand` is already in your portfolio
(`tech-agentic-app`), so this is a familiar tool used narrowly.

