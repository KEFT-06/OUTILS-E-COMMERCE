CREATE TYPE "public"."credit_reason" AS ENUM('plan_cycle', 'usage', 'refund', 'admin_grant', 'plan_change');--> statement-breakpoint
CREATE TYPE "public"."feature_access" AS ENUM('granted', 'revoked');--> statement-breakpoint
CREATE TYPE "public"."generation_kind" AS ENUM('video', 'image', 'storybook', 'ebook', 'product_page', 'report_pdf', 'swipe_file', 'launch_kit', 'ad_scan');--> statement-breakpoint
CREATE TYPE "public"."generation_status" AS ENUM('pending', 'completed', 'failed');--> statement-breakpoint
CREATE TYPE "public"."payment_method" AS ENUM('mobile_money', 'card', 'bank_transfer', 'cash', 'chariow', 'other');--> statement-breakpoint
CREATE TYPE "public"."payment_status" AS ENUM('paid', 'refunded');--> statement-breakpoint
CREATE TYPE "public"."plan_id" AS ENUM('free', 'plus', 'pro', 'max', 'elite');--> statement-breakpoint
CREATE TYPE "public"."token_purpose" AS ENUM('setup', 'reset');--> statement-breakpoint
CREATE TYPE "public"."usage_source" AS ENUM('server', 'client');--> statement-breakpoint
CREATE TYPE "public"."user_role" AS ENUM('user', 'admin');--> statement-breakpoint
CREATE TYPE "public"."user_status" AS ENUM('active', 'suspended');--> statement-breakpoint
CREATE TABLE "audit_logs" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"actor_id" uuid,
	"actor_email" text NOT NULL,
	"action" text NOT NULL,
	"target_user_id" uuid,
	"target_email" text,
	"details" jsonb,
	"ip_address" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "audit_logs" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "auth_events" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid,
	"email" text,
	"type" text NOT NULL,
	"ip_address" text,
	"user_agent" text,
	"details" jsonb,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "auth_events" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "auth_throttles" (
	"key" text PRIMARY KEY NOT NULL,
	"failures" integer DEFAULT 0 NOT NULL,
	"locked_until" timestamp with time zone,
	"last_failure_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "auth_throttles" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "credit_transactions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid NOT NULL,
	"plan_delta" integer DEFAULT 0 NOT NULL,
	"bonus_delta" integer DEFAULT 0 NOT NULL,
	"reason" "credit_reason" NOT NULL,
	"action_id" text,
	"generation_id" uuid,
	"actor_id" uuid,
	"note" text,
	"balance_after" integer NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "credit_transactions" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "feature_overrides" (
	"user_id" uuid NOT NULL,
	"feature" text NOT NULL,
	"access" "feature_access" NOT NULL,
	"set_by" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "feature_overrides_user_id_feature_pk" PRIMARY KEY("user_id","feature")
);
--> statement-breakpoint
ALTER TABLE "feature_overrides" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "generations" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid NOT NULL,
	"kind" "generation_kind" NOT NULL,
	"provider" text NOT NULL,
	"provider_ref" text,
	"status" "generation_status" NOT NULL,
	"file_format" text,
	"source" "usage_source" DEFAULT 'server' NOT NULL,
	"credits_charged" integer DEFAULT 0 NOT NULL,
	"debit_transaction_id" uuid,
	"refunded" boolean DEFAULT false NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"completed_at" timestamp with time zone
);
--> statement-breakpoint
ALTER TABLE "generations" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "mfa_challenges" (
	"id" text PRIMARY KEY NOT NULL,
	"user_id" uuid NOT NULL,
	"attempts" integer DEFAULT 0 NOT NULL,
	"ip_address" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"expires_at" timestamp with time zone NOT NULL
);
--> statement-breakpoint
ALTER TABLE "mfa_challenges" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "password_tokens" (
	"id" text PRIMARY KEY NOT NULL,
	"user_id" uuid NOT NULL,
	"purpose" "token_purpose" NOT NULL,
	"created_by" uuid,
	"expires_at" timestamp with time zone NOT NULL,
	"used_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "password_tokens" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "payments" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid,
	"user_email" text NOT NULL,
	"plan" "plan_id" NOT NULL,
	"period_months" integer NOT NULL,
	"amount_fcfa" integer NOT NULL,
	"method" "payment_method" NOT NULL,
	"reference" text,
	"status" "payment_status" DEFAULT 'paid' NOT NULL,
	"paid_at" timestamp with time zone NOT NULL,
	"recorded_by" uuid,
	"note" text,
	"refunded_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "payments" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "recovery_codes" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid NOT NULL,
	"code_hash" text NOT NULL,
	"used_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "recovery_codes" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "sessions" (
	"id" text PRIMARY KEY NOT NULL,
	"user_id" uuid NOT NULL,
	"mfa_verified" boolean DEFAULT false NOT NULL,
	"ip_address" text,
	"user_agent" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"last_seen_at" timestamp with time zone DEFAULT now() NOT NULL,
	"expires_at" timestamp with time zone NOT NULL
);
--> statement-breakpoint
ALTER TABLE "sessions" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "user_integrations" (
	"user_id" uuid NOT NULL,
	"provider" text NOT NULL,
	"secret" text NOT NULL,
	"hint" text NOT NULL,
	"verified_at" timestamp with time zone NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "user_integrations_user_id_provider_pk" PRIMARY KEY("user_id","provider")
);
--> statement-breakpoint
ALTER TABLE "user_integrations" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "user_permissions" (
	"user_id" uuid NOT NULL,
	"permission" text NOT NULL,
	"granted_by" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "user_permissions_user_id_permission_pk" PRIMARY KEY("user_id","permission")
);
--> statement-breakpoint
ALTER TABLE "user_permissions" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "users" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"email" text NOT NULL,
	"name" text NOT NULL,
	"password_hash" text,
	"role" "user_role" DEFAULT 'user' NOT NULL,
	"status" "user_status" DEFAULT 'active' NOT NULL,
	"suspended_reason" text,
	"plan" "plan_id" DEFAULT 'free' NOT NULL,
	"plan_expires_at" timestamp with time zone,
	"plan_credits" integer DEFAULT 0 NOT NULL,
	"bonus_credits" integer DEFAULT 0 NOT NULL,
	"credits_cycle_ends_at" timestamp with time zone NOT NULL,
	"two_factor_secret" text,
	"two_factor_pending_secret" text,
	"two_factor_enabled_at" timestamp with time zone,
	"two_factor_last_step" integer,
	"saved_niches" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"last_login_at" timestamp with time zone,
	"password_changed_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "users" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "audit_logs" ADD CONSTRAINT "audit_logs_actor_id_users_id_fk" FOREIGN KEY ("actor_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "audit_logs" ADD CONSTRAINT "audit_logs_target_user_id_users_id_fk" FOREIGN KEY ("target_user_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "auth_events" ADD CONSTRAINT "auth_events_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "credit_transactions" ADD CONSTRAINT "credit_transactions_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "credit_transactions" ADD CONSTRAINT "credit_transactions_actor_id_users_id_fk" FOREIGN KEY ("actor_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "feature_overrides" ADD CONSTRAINT "feature_overrides_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "feature_overrides" ADD CONSTRAINT "feature_overrides_set_by_users_id_fk" FOREIGN KEY ("set_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "generations" ADD CONSTRAINT "generations_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "mfa_challenges" ADD CONSTRAINT "mfa_challenges_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "password_tokens" ADD CONSTRAINT "password_tokens_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "password_tokens" ADD CONSTRAINT "password_tokens_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "payments" ADD CONSTRAINT "payments_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "payments" ADD CONSTRAINT "payments_recorded_by_users_id_fk" FOREIGN KEY ("recorded_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "recovery_codes" ADD CONSTRAINT "recovery_codes_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "sessions" ADD CONSTRAINT "sessions_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "user_integrations" ADD CONSTRAINT "user_integrations_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "user_permissions" ADD CONSTRAINT "user_permissions_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "user_permissions" ADD CONSTRAINT "user_permissions_granted_by_users_id_fk" FOREIGN KEY ("granted_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "audit_logs_created_idx" ON "audit_logs" USING btree ("created_at");--> statement-breakpoint
CREATE INDEX "audit_logs_target_idx" ON "audit_logs" USING btree ("target_user_id");--> statement-breakpoint
CREATE INDEX "auth_events_created_idx" ON "auth_events" USING btree ("created_at");--> statement-breakpoint
CREATE INDEX "auth_events_user_idx" ON "auth_events" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX "credit_transactions_user_idx" ON "credit_transactions" USING btree ("user_id","created_at");--> statement-breakpoint
CREATE INDEX "credit_transactions_created_idx" ON "credit_transactions" USING btree ("created_at");--> statement-breakpoint
CREATE UNIQUE INDEX "generations_provider_ref_unique" ON "generations" USING btree ("provider","provider_ref");--> statement-breakpoint
CREATE INDEX "generations_user_idx" ON "generations" USING btree ("user_id","created_at");--> statement-breakpoint
CREATE INDEX "generations_kind_idx" ON "generations" USING btree ("kind","created_at");--> statement-breakpoint
CREATE INDEX "mfa_challenges_user_idx" ON "mfa_challenges" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX "password_tokens_user_idx" ON "password_tokens" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX "payments_paid_idx" ON "payments" USING btree ("paid_at");--> statement-breakpoint
CREATE INDEX "payments_user_idx" ON "payments" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX "recovery_codes_user_idx" ON "recovery_codes" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX "sessions_user_idx" ON "sessions" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX "sessions_last_seen_idx" ON "sessions" USING btree ("last_seen_at");--> statement-breakpoint
CREATE UNIQUE INDEX "users_email_unique" ON "users" USING btree ("email");--> statement-breakpoint
CREATE INDEX "users_created_idx" ON "users" USING btree ("created_at");