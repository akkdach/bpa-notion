CREATE TABLE "activity_logs" (
	"id" bigint PRIMARY KEY GENERATED ALWAYS AS IDENTITY (sequence name "activity_logs_id_seq" INCREMENT BY 1 MINVALUE 1 MAXVALUE 9223372036854775807 START WITH 1 CACHE 1),
	"workspace_id" uuid NOT NULL,
	"page_id" uuid,
	"page_title" varchar(400) NOT NULL,
	"actor_user_id" uuid,
	"action" varchar(40) NOT NULL,
	"detail" jsonb,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "api_tokens" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"workspace_id" uuid NOT NULL,
	"user_id" uuid NOT NULL,
	"name" varchar(100) NOT NULL,
	"token_hash" varchar(64) NOT NULL,
	"last4" varchar(8) NOT NULL,
	"created_by" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"expires_at" timestamp with time zone,
	"last_used_at" timestamp with time zone,
	"revoked_at" timestamp with time zone
);
--> statement-breakpoint
CREATE TABLE "page_acls" (
	"page_id" uuid NOT NULL,
	"workspace_id" uuid NOT NULL,
	"subject_type" varchar(20) NOT NULL,
	"subject_id" uuid NOT NULL,
	"role" varchar(20) NOT NULL,
	"granted_by" uuid,
	"granted_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "pk_page_acls" PRIMARY KEY("page_id","subject_type","subject_id")
);
--> statement-breakpoint
CREATE TABLE "page_doc_snapshots" (
	"id" bigint PRIMARY KEY GENERATED ALWAYS AS IDENTITY (sequence name "page_doc_snapshots_id_seq" INCREMENT BY 1 MINVALUE 1 MAXVALUE 9223372036854775807 START WITH 1 CACHE 1),
	"workspace_id" uuid NOT NULL,
	"page_id" uuid NOT NULL,
	"snapshot" "bytea" NOT NULL,
	"up_to_seq" bigint NOT NULL,
	"byte_size" integer NOT NULL,
	"is_trusted" boolean DEFAULT true NOT NULL,
	"created_by" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "page_doc_updates" (
	"seq" bigint PRIMARY KEY GENERATED ALWAYS AS IDENTITY (sequence name "page_doc_updates_seq_seq" INCREMENT BY 1 MINVALUE 1 MAXVALUE 9223372036854775807 START WITH 1 CACHE 1),
	"workspace_id" uuid NOT NULL,
	"page_id" uuid NOT NULL,
	"update_data" "bytea" NOT NULL,
	"y_client_id" bigint,
	"author_user_id" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "page_links" (
	"workspace_id" uuid NOT NULL,
	"source_page_id" uuid NOT NULL,
	"target_page_id" uuid NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "pk_page_links" PRIMARY KEY("source_page_id","target_page_id")
);
--> statement-breakpoint
CREATE TABLE "page_notes" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"workspace_id" uuid NOT NULL,
	"page_id" uuid NOT NULL,
	"author_user_id" uuid,
	"body" varchar(4000) NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "page_searches" (
	"page_id" uuid PRIMARY KEY NOT NULL,
	"workspace_id" uuid NOT NULL,
	"access_root_id" uuid NOT NULL,
	"database_id" uuid,
	"title" text DEFAULT '' NOT NULL,
	"body_text" text DEFAULT '' NOT NULL,
	"search_text" text GENERATED ALWAYS AS (title || ' ' || body_text) STORED,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "pages" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"workspace_id" uuid NOT NULL,
	"parent_id" uuid,
	"ancestor_ids" uuid[] DEFAULT '{}'::uuid[] NOT NULL,
	"depth" integer DEFAULT 0 NOT NULL,
	"rank" varchar(200) NOT NULL,
	"kind" varchar(20) NOT NULL,
	"database_id" uuid,
	"title" text DEFAULT '' NOT NULL,
	"icon" varchar(200),
	"cover_url" varchar(1000),
	"status" varchar(20),
	"properties" jsonb,
	"computed" jsonb,
	"access_root_id" uuid NOT NULL,
	"archived_at" timestamp with time zone,
	"deleted_at" timestamp with time zone,
	"created_by" uuid,
	"last_edited_by" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "ux_pages_workspace_id_id" UNIQUE("workspace_id","id")
);
--> statement-breakpoint
CREATE TABLE "refresh_tokens" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid NOT NULL,
	"token_hash" varchar(64) NOT NULL,
	"expires_at" timestamp with time zone NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"revoked_at" timestamp with time zone,
	"replaced_by_token_id" uuid,
	"user_agent" varchar(400),
	"ip_address" varchar(45)
);
--> statement-breakpoint
CREATE TABLE "users" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"email" "citext" NOT NULL,
	"password_hash" varchar(120) NOT NULL,
	"name" varchar(200) NOT NULL,
	"avatar_url" varchar(1000),
	"locale" varchar(10) DEFAULT 'th' NOT NULL,
	"kind" varchar(20) DEFAULT 'human' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"last_login_at" timestamp with time zone
);
--> statement-breakpoint
CREATE TABLE "workspace_members" (
	"workspace_id" uuid NOT NULL,
	"user_id" uuid NOT NULL,
	"role" varchar(20) NOT NULL,
	"joined_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "pk_workspace_members" PRIMARY KEY("workspace_id","user_id")
);
--> statement-breakpoint
CREATE TABLE "workspaces" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"slug" varchar(60) NOT NULL,
	"name" varchar(200) NOT NULL,
	"icon" varchar(200),
	"created_by" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"deleted_at" timestamp with time zone
);
--> statement-breakpoint
ALTER TABLE "activity_logs" ADD CONSTRAINT "fk_activity_logs_pages" FOREIGN KEY ("workspace_id","page_id") REFERENCES "public"."pages"("workspace_id","id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "api_tokens" ADD CONSTRAINT "api_tokens_workspace_id_workspaces_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."workspaces"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "api_tokens" ADD CONSTRAINT "api_tokens_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "page_acls" ADD CONSTRAINT "fk_page_acls_pages" FOREIGN KEY ("workspace_id","page_id") REFERENCES "public"."pages"("workspace_id","id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "page_doc_snapshots" ADD CONSTRAINT "fk_page_doc_snapshots_pages" FOREIGN KEY ("workspace_id","page_id") REFERENCES "public"."pages"("workspace_id","id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "page_doc_updates" ADD CONSTRAINT "fk_page_doc_updates_pages" FOREIGN KEY ("workspace_id","page_id") REFERENCES "public"."pages"("workspace_id","id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "page_links" ADD CONSTRAINT "fk_page_links_source" FOREIGN KEY ("workspace_id","source_page_id") REFERENCES "public"."pages"("workspace_id","id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "page_links" ADD CONSTRAINT "fk_page_links_target" FOREIGN KEY ("workspace_id","target_page_id") REFERENCES "public"."pages"("workspace_id","id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "page_notes" ADD CONSTRAINT "fk_page_notes_pages" FOREIGN KEY ("workspace_id","page_id") REFERENCES "public"."pages"("workspace_id","id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "page_searches" ADD CONSTRAINT "fk_page_searches_pages" FOREIGN KEY ("workspace_id","page_id") REFERENCES "public"."pages"("workspace_id","id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "pages" ADD CONSTRAINT "pages_workspace_id_workspaces_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."workspaces"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "pages" ADD CONSTRAINT "fk_pages_parent" FOREIGN KEY ("workspace_id","parent_id") REFERENCES "public"."pages"("workspace_id","id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "refresh_tokens" ADD CONSTRAINT "refresh_tokens_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "workspace_members" ADD CONSTRAINT "workspace_members_workspace_id_workspaces_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."workspaces"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "workspace_members" ADD CONSTRAINT "workspace_members_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "ix_activity_logs_workspace_id_created_at" ON "activity_logs" USING btree ("workspace_id","created_at");--> statement-breakpoint
CREATE INDEX "ix_activity_logs_workspace_id_page_id_created_at" ON "activity_logs" USING btree ("workspace_id","page_id","created_at");--> statement-breakpoint
CREATE UNIQUE INDEX "ux_api_tokens_token_hash" ON "api_tokens" USING btree ("token_hash");--> statement-breakpoint
CREATE INDEX "ix_api_tokens_workspace_id_created_at" ON "api_tokens" USING btree ("workspace_id","created_at");--> statement-breakpoint
CREATE UNIQUE INDEX "ux_page_doc_snapshots_page_id_up_to_seq" ON "page_doc_snapshots" USING btree ("page_id","up_to_seq");--> statement-breakpoint
CREATE INDEX "ix_page_doc_updates_page_id_seq" ON "page_doc_updates" USING btree ("page_id","seq");--> statement-breakpoint
CREATE INDEX "ix_page_links_workspace_id_target_page_id" ON "page_links" USING btree ("workspace_id","target_page_id");--> statement-breakpoint
CREATE INDEX "ix_page_notes_workspace_id_page_id_created_at" ON "page_notes" USING btree ("workspace_id","page_id","created_at");--> statement-breakpoint
CREATE INDEX "ix_page_searches_workspace_id_access_root_id" ON "page_searches" USING btree ("workspace_id","access_root_id");--> statement-breakpoint
CREATE INDEX "ix_pages_workspace_id_access_root_id" ON "pages" USING btree ("workspace_id","access_root_id");--> statement-breakpoint
CREATE UNIQUE INDEX "ux_refresh_tokens_token_hash" ON "refresh_tokens" USING btree ("token_hash");--> statement-breakpoint
CREATE INDEX "ix_refresh_tokens_user_id_expires_at" ON "refresh_tokens" USING btree ("user_id","expires_at");--> statement-breakpoint
CREATE UNIQUE INDEX "ux_users_email" ON "users" USING btree ("email");--> statement-breakpoint
CREATE INDEX "ix_workspace_members_user_id" ON "workspace_members" USING btree ("user_id");--> statement-breakpoint
CREATE UNIQUE INDEX "ux_workspaces_slug" ON "workspaces" USING btree ("slug");--> statement-breakpoint
CREATE INDEX "ix_workspaces_deleted_at" ON "workspaces" USING btree ("deleted_at");