import { table, integer, text, sql } from 'sdk/db';

export const users = table('users', {
  id:         integer('id').primaryKey(),
  language:   text('language'),
  firstSeen:  integer('first_seen', { mode: 'timestamp' }).default(sql`(unixepoch())`),
  lastSeen:   integer('last_seen', { mode: 'timestamp' }).default(sql`(unixepoch())`),
  startParam: text('start_param'),
});

export const botConfig = table('bot_config', {
  key:       text('key').primaryKey(),
  value:     text('value').notNull(),
  updatedAt: integer('updated_at').notNull(),
});

export const pvlCache = table('pvl_cache', {
  key:       text('key').primaryKey(),
  body:      text('body').notNull(),
  etag:      text('etag'),
  fetchedAt: integer('fetched_at').notNull(),
});
