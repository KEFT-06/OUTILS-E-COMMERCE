CREATE TABLE "market_sales_daily" (
	"product_id" uuid NOT NULL,
	"day" text NOT NULL,
	"sales_count" integer NOT NULL,
	CONSTRAINT "market_sales_daily_product_id_day_pk" PRIMARY KEY("product_id","day")
);
--> statement-breakpoint
ALTER TABLE "market_sales_daily" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "market_sales_daily" ADD CONSTRAINT "market_sales_daily_product_id_market_products_id_fk" FOREIGN KEY ("product_id") REFERENCES "public"."market_products"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "market_sales_daily_day_idx" ON "market_sales_daily" USING btree ("day");