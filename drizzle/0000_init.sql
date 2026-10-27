CREATE TABLE "block_objects" (
	"account_id" bigint NOT NULL,
	"hash" char(64) NOT NULL,
	"size" integer NOT NULL,
	"stored_size" integer NOT NULL,
	"storage_tier" varchar(8) DEFAULT 'hot' NOT NULL,
	"last_accessed_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "block_objects_account_id_hash_pk" PRIMARY KEY("account_id","hash"),
	CONSTRAINT "block_objects_tier_check" CHECK ("block_objects"."storage_tier" IN ('hot', 'cold'))
);
--> statement-breakpoint
CREATE TABLE "blocks" (
	"id" bigserial PRIMARY KEY NOT NULL,
	"file_version_id" bigint NOT NULL,
	"block_order" integer NOT NULL,
	"hash" char(64) NOT NULL,
	"size" integer NOT NULL,
	CONSTRAINT "blocks_version_order_uniq" UNIQUE("file_version_id","block_order"),
	CONSTRAINT "blocks_order_check" CHECK ("blocks"."block_order" >= 0),
	CONSTRAINT "blocks_size_check" CHECK ("blocks"."size" BETWEEN 1 AND 4194304)
);
--> statement-breakpoint
CREATE TABLE "devices" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" bigint NOT NULL,
	"name" varchar(64) NOT NULL,
	"push_id" varchar(255),
	"last_logged_in_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "events" (
	"id" bigserial PRIMARY KEY NOT NULL,
	"namespace_id" bigint NOT NULL,
	"type" varchar(16) NOT NULL,
	"path" varchar(1024) NOT NULL,
	"version_number" integer,
	"device_id" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "events_type_check" CHECK ("events"."type" IN ('file_added', 'file_updated', 'file_deleted', 'upload_started', 'share_created'))
);
--> statement-breakpoint
CREATE TABLE "file_version_keeps" (
	"file_version_id" bigint PRIMARY KEY NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "file_versions" (
	"id" bigserial PRIMARY KEY NOT NULL,
	"file_id" bigint NOT NULL,
	"device_id" uuid,
	"version_number" integer,
	"status" varchar(16) NOT NULL,
	"base_version" integer,
	"size" bigint NOT NULL,
	"checksum" char(64) NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"last_modified" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "file_versions_file_version_uniq" UNIQUE("file_id","version_number"),
	CONSTRAINT "file_versions_status_check" CHECK ("file_versions"."status" IN ('pending', 'uploaded', 'expired')),
	CONSTRAINT "file_versions_size_check" CHECK ("file_versions"."size" BETWEEN 0 AND 10737418240),
	CONSTRAINT "file_versions_number_iff_uploaded" CHECK (("file_versions"."status" = 'uploaded') = ("file_versions"."version_number" IS NOT NULL))
);
--> statement-breakpoint
CREATE TABLE "files" (
	"id" bigserial PRIMARY KEY NOT NULL,
	"namespace_id" bigint NOT NULL,
	"file_name" varchar(255) NOT NULL,
	"relative_path" varchar(1024) NOT NULL,
	"is_directory" boolean NOT NULL,
	"latest_version" integer,
	"size" bigint DEFAULT 0 NOT NULL,
	"checksum" char(64),
	"deleted_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"last_modified" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "namespaces" (
	"id" bigserial PRIMARY KEY NOT NULL,
	"owner_id" bigint NOT NULL,
	"is_shared" boolean DEFAULT false NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "namespaces_owner_id_unique" UNIQUE("owner_id")
);
--> statement-breakpoint
CREATE TABLE "shares" (
	"id" bigserial PRIMARY KEY NOT NULL,
	"namespace_id" bigint NOT NULL,
	"folder_path" varchar(1024) NOT NULL,
	"grantee_id" bigint NOT NULL,
	"role" varchar(8) NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "shares_folder_grantee_uniq" UNIQUE("namespace_id","folder_path","grantee_id"),
	CONSTRAINT "shares_role_check" CHECK ("shares"."role" IN ('viewer', 'editor'))
);
--> statement-breakpoint
CREATE TABLE "upload_session_blocks" (
	"upload_id" uuid NOT NULL,
	"hash" char(64) NOT NULL,
	"received" boolean DEFAULT false NOT NULL,
	CONSTRAINT "upload_session_blocks_upload_id_hash_pk" PRIMARY KEY("upload_id","hash")
);
--> statement-breakpoint
CREATE TABLE "upload_sessions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"file_version_id" bigint NOT NULL,
	"account_id" bigint NOT NULL,
	"user_id" bigint NOT NULL,
	"status" varchar(16) NOT NULL,
	"result" jsonb,
	"expires_at" timestamp with time zone NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "upload_sessions_file_version_id_unique" UNIQUE("file_version_id"),
	CONSTRAINT "upload_sessions_status_check" CHECK ("upload_sessions"."status" IN ('open', 'completed', 'conflicted', 'expired'))
);
--> statement-breakpoint
CREATE TABLE "users" (
	"id" bigserial PRIMARY KEY NOT NULL,
	"email" varchar(254) NOT NULL,
	"user_name" varchar(64) NOT NULL,
	"password_hash" varchar(72) NOT NULL,
	"quota_bytes" bigint DEFAULT 10737418240 NOT NULL,
	"used_bytes" bigint DEFAULT 0 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "users_email_unique" UNIQUE("email"),
	CONSTRAINT "users_used_bytes_non_negative" CHECK ("users"."used_bytes" >= 0)
);
--> statement-breakpoint
ALTER TABLE "block_objects" ADD CONSTRAINT "block_objects_account_id_users_id_fk" FOREIGN KEY ("account_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "blocks" ADD CONSTRAINT "blocks_file_version_id_file_versions_id_fk" FOREIGN KEY ("file_version_id") REFERENCES "public"."file_versions"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "devices" ADD CONSTRAINT "devices_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "events" ADD CONSTRAINT "events_namespace_id_namespaces_id_fk" FOREIGN KEY ("namespace_id") REFERENCES "public"."namespaces"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "file_version_keeps" ADD CONSTRAINT "file_version_keeps_file_version_id_file_versions_id_fk" FOREIGN KEY ("file_version_id") REFERENCES "public"."file_versions"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "file_versions" ADD CONSTRAINT "file_versions_file_id_files_id_fk" FOREIGN KEY ("file_id") REFERENCES "public"."files"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "file_versions" ADD CONSTRAINT "file_versions_device_id_devices_id_fk" FOREIGN KEY ("device_id") REFERENCES "public"."devices"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "files" ADD CONSTRAINT "files_namespace_id_namespaces_id_fk" FOREIGN KEY ("namespace_id") REFERENCES "public"."namespaces"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "namespaces" ADD CONSTRAINT "namespaces_owner_id_users_id_fk" FOREIGN KEY ("owner_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "shares" ADD CONSTRAINT "shares_namespace_id_namespaces_id_fk" FOREIGN KEY ("namespace_id") REFERENCES "public"."namespaces"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "shares" ADD CONSTRAINT "shares_grantee_id_users_id_fk" FOREIGN KEY ("grantee_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "upload_session_blocks" ADD CONSTRAINT "upload_session_blocks_upload_id_upload_sessions_id_fk" FOREIGN KEY ("upload_id") REFERENCES "public"."upload_sessions"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "upload_sessions" ADD CONSTRAINT "upload_sessions_file_version_id_file_versions_id_fk" FOREIGN KEY ("file_version_id") REFERENCES "public"."file_versions"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "upload_sessions" ADD CONSTRAINT "upload_sessions_account_id_users_id_fk" FOREIGN KEY ("account_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "upload_sessions" ADD CONSTRAINT "upload_sessions_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "blocks_hash_idx" ON "blocks" USING btree ("hash");--> statement-breakpoint
CREATE INDEX "devices_user_idx" ON "devices" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX "events_ns_id_idx" ON "events" USING btree ("namespace_id","id");--> statement-breakpoint
CREATE UNIQUE INDEX "files_live_path_uniq" ON "files" USING btree ("namespace_id","relative_path") WHERE "files"."deleted_at" IS NULL;--> statement-breakpoint
CREATE INDEX "files_modified_idx" ON "files" USING btree ("namespace_id","last_modified" DESC NULLS FIRST);--> statement-breakpoint
CREATE INDEX "shares_grantee_idx" ON "shares" USING btree ("grantee_id");