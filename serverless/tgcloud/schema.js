import { table, integer, text, sql } from 'sdk/db';

export const users = table('users', {
  id:            integer('id').primaryKey(),
  language:      text('language'),
  firstSeen:     integer('first_seen', { mode: 'timestamp' }).default(sql`(unixepoch())`),
  lastSeen:      integer('last_seen', { mode: 'timestamp' }).default(sql`(unixepoch())`),
  startParam:    text('start_param'),
  flowState:     text('flow_state'),
  flowExpiresAt: integer('flow_expires_at'),
  riskAck:       integer('risk_ack').default(0),
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

export const connectionRateLimits = table('connection_rate_limits', {
  userId:      integer('user_id').primaryKey(),
  windowStart: integer('window_start').notNull(),
  count:       integer('count').notNull(),
});

export const ipGeo = table('ip_geo', {
  ip:          text('ip').primaryKey(),
  countryCode: text('country_code').notNull(),
  updatedAt:   integer('updated_at').notNull(),
});

export const counters = table('counters', {
  key:       text('key').primaryKey(),
  value:     integer('value').notNull().default(0),
  updatedAt: integer('updated_at').notNull(),
});
