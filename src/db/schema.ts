import { pgTable, serial, text, timestamp } from 'drizzle-orm/pg-core';

export const accounts = pgTable('accounts', {
  id: serial('id').primaryKey(),
  address: text('address').notNull().unique(),
  publicKey: text('public_key').notNull(),
  privateKey: text("private_key").notNull(),
  mnemonic: text('mnemonic').notNull(),
  scheme: text('scheme').notNull(),
  network: text('network').notNull(),
  user_id: text('user_id').notNull(),
  createdAt: timestamp('created_at').defaultNow().notNull(),
}); 