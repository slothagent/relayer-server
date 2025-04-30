CREATE TABLE "accounts" (
	"id" serial PRIMARY KEY NOT NULL,
	"address" text NOT NULL,
	"public_key" text NOT NULL,
	"scheme" text NOT NULL,
	"username" text NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "accounts_address_unique" UNIQUE("address")
);
