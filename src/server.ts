import {
  AngularNodeAppEngine,
  createNodeRequestHandler,
  isMainModule,
  writeResponseToNodeResponse,
} from '@angular/ssr/node';
import express, { type NextFunction, type Request, type Response } from 'express';
import {
  createCipheriv,
  createDecipheriv,
  randomBytes,
  randomUUID,
  timingSafeEqual,
} from 'node:crypto';
import { chmodSync, mkdirSync } from 'node:fs';
import { createRequire } from 'node:module';
import { dirname, join, resolve } from 'node:path';
import type { DatabaseSync as SqliteDatabase } from 'node:sqlite';
import { neon, type NeonQueryFunction } from '@neondatabase/serverless';
import nodemailer, { type Transporter } from 'nodemailer';
import { membershipDirectory } from './membership-directory';
import { isMembershipRenewed } from './renewed-memberships';
import {
  mergeMembershipProfile,
  type MembershipProfile,
} from './membership-profile';
import {
  getMembershipNames,
  getMembershipPhoneNumbers,
} from './membership-family-directory';

const browserDistFolder = join(import.meta.dirname, '../browser');
const require = createRequire(import.meta.url);
const registrationGames = ['Carroms', 'Chess', 'PlayStation', 'Cards'] as const;
type Game = (typeof registrationGames)[number];
type GameChoice = { game: Game; category: string };
type Registration = {
  id: string;
  createdAt: string;
  name: string;
  membershipNumber: string;
  age: number;
  phone: string;
  email: string;
  guardian: string;
  paymentConfirmed: boolean;
  games: GameChoice[];
  emailSent: boolean;
};
type RegistrationInput = Omit<Registration, 'id' | 'createdAt' | 'games' | 'emailSent'> & {
  games: Game[];
};
type RegistrationClearSchedule = {
  requestedAt: string;
  scheduledFor: string;
};
type MembershipRenewal = MembershipProfile;
type ContactDetailsUpdate = {
  id: string;
  createdAt: string;
  phone: string;
  membershipNumber: string;
  name: string;
  email: string;
  address: string;
  consent: true;
};

const app = express();
const angularApp = new AngularNodeAppEngine();
app.use(express.json({ limit: '10kb' }));

let database: SqliteDatabase | undefined;
let neonSql: NeonQueryFunction<false, false> | undefined;
let neonSchemaReady: Promise<void> | undefined;

function getSqliteDatabase(): SqliteDatabase {
  if (process.env['VERCEL'] && !process.env['DATABASE_URL']) {
    throw new Error('DATABASE_URL is required for durable registration storage on Vercel.');
  }
  if (database) {
    return database;
  }
  const { DatabaseSync } = require('node:sqlite') as typeof import('node:sqlite');

  const databasePath = resolve(
    process.env['REGISTRATION_DB_PATH'] ||
      join(process.cwd(), 'data', 'registrations.sqlite'),
  );
  mkdirSync(dirname(databasePath), { recursive: true, mode: 0o700 });
  database = new DatabaseSync(databasePath);
  database.exec(`
    PRAGMA journal_mode = WAL;
    CREATE TABLE IF NOT EXISTS registrations (
      id TEXT PRIMARY KEY,
      created_at TEXT NOT NULL,
      registration_data TEXT NOT NULL,
      email_sent INTEGER NOT NULL DEFAULT 0
    );
    CREATE TABLE IF NOT EXISTS registration_clear_schedule (
      schedule_key TEXT PRIMARY KEY,
      requested_at TEXT NOT NULL,
      scheduled_for TEXT NOT NULL
    );
    CREATE TABLE IF NOT EXISTS membership_renewals (
      id TEXT PRIMARY KEY,
      created_at TEXT NOT NULL,
      renewal_data TEXT NOT NULL
    );
    CREATE TABLE IF NOT EXISTS membership_directory_profiles (
      membership_number TEXT PRIMARY KEY,
      profile_data TEXT NOT NULL
    );
    CREATE TABLE IF NOT EXISTS membership_renewal_status (
      membership_number TEXT PRIMARY KEY,
      renewed BOOLEAN NOT NULL
    );
    CREATE TABLE IF NOT EXISTS membership_renewal_clear_schedule (
      schedule_key TEXT PRIMARY KEY,
      requested_at TEXT NOT NULL,
      scheduled_for TEXT NOT NULL
    );
    CREATE TABLE IF NOT EXISTS contact_details_updates (
      id TEXT PRIMARY KEY,
      created_at TEXT NOT NULL,
      update_data TEXT NOT NULL
    );
    CREATE TABLE IF NOT EXISTS contact_details_clear_schedule (
      schedule_key TEXT PRIMARY KEY,
      requested_at TEXT NOT NULL,
      scheduled_for TEXT NOT NULL
    )
  `);
  chmodSync(databasePath, 0o600);
  return database;
}

function getNeonSql(): NeonQueryFunction<false, false> {
  const connectionString = process.env['DATABASE_URL'];
  if (!connectionString) {
    throw new Error('DATABASE_URL is not configured.');
  }
  neonSql ??= neon(connectionString);
  return neonSql;
}

async function ensureNeonSchema(): Promise<void> {
  if (!neonSchemaReady) {
    neonSchemaReady = getNeonSql()`CREATE TABLE IF NOT EXISTS registrations (
      id TEXT PRIMARY KEY,
      created_at TEXT NOT NULL,
      registration_data TEXT NOT NULL,
      email_sent BOOLEAN NOT NULL DEFAULT FALSE
    )`
      .then(() =>
        getNeonSql()`CREATE TABLE IF NOT EXISTS registration_clear_schedule (
          schedule_key TEXT PRIMARY KEY,
          requested_at TEXT NOT NULL,
          scheduled_for TEXT NOT NULL
        )`,
      )
      .then(() =>
        getNeonSql()`CREATE TABLE IF NOT EXISTS membership_renewals (
          id TEXT PRIMARY KEY,
          created_at TEXT NOT NULL,
          renewal_data TEXT NOT NULL
        )`,
      )
      .then(() =>
        getNeonSql()`CREATE TABLE IF NOT EXISTS membership_renewal_clear_schedule (
          schedule_key TEXT PRIMARY KEY,
          requested_at TEXT NOT NULL,
          scheduled_for TEXT NOT NULL
        )`,
      )
      .then(() =>
        getNeonSql()`CREATE TABLE IF NOT EXISTS membership_directory_profiles (
          membership_number TEXT PRIMARY KEY,
          profile_data TEXT NOT NULL
        )`,
      )
      .then(() =>
        getNeonSql()`CREATE TABLE IF NOT EXISTS membership_renewal_status (
          membership_number TEXT PRIMARY KEY,
          renewed BOOLEAN NOT NULL
        )`,
      )
      .then(() =>
        getNeonSql()`CREATE TABLE IF NOT EXISTS contact_details_updates (
          id TEXT PRIMARY KEY,
          created_at TEXT NOT NULL,
          update_data TEXT NOT NULL
        )`,
      )
      .then(() =>
        getNeonSql()`CREATE TABLE IF NOT EXISTS contact_details_clear_schedule (
          schedule_key TEXT PRIMARY KEY,
          requested_at TEXT NOT NULL,
          scheduled_for TEXT NOT NULL
        )`,
      )
      .then(() => undefined)
      .catch((error: unknown) => {
        neonSchemaReady = undefined;
        throw error;
      });
  }
  await neonSchemaReady;
}

function hasPersistentStorageConfigured(): boolean {
  return Boolean(process.env['DATABASE_URL']) || !process.env['VERCEL'];
}

type StoredRegistrationRow = {
  registration_data: unknown;
  email_sent: unknown;
};

async function saveRegistration(registration: Registration, key: Buffer): Promise<void> {
  const encodedRegistration = encryptRegistration(registration, key);
  if (process.env['DATABASE_URL']) {
    await ensureNeonSchema();
    await getNeonSql()`INSERT INTO registrations
      (id, created_at, registration_data)
      VALUES (${registration.id}, ${registration.createdAt}, ${encodedRegistration})`;
    return;
  }

  getSqliteDatabase()
    .prepare(
      `INSERT INTO registrations
        (id, created_at, registration_data)
       VALUES (?, ?, ?)`,
    )
    .run(registration.id, registration.createdAt, encodedRegistration);
}

async function setEmailSent(registrationId: string): Promise<void> {
  if (process.env['DATABASE_URL']) {
    await ensureNeonSchema();
    await getNeonSql()`UPDATE registrations SET email_sent = TRUE WHERE id = ${registrationId}`;
    return;
  }

  getSqliteDatabase()
    .prepare('UPDATE registrations SET email_sent = 1 WHERE id = ?')
    .run(registrationId);
}

async function getRegistrations(): Promise<StoredRegistrationRow[]> {
  if (process.env['DATABASE_URL']) {
    await ensureNeonSchema();
    const rows = await getNeonSql()`SELECT registration_data, email_sent
      FROM registrations
      ORDER BY created_at DESC
      LIMIT 500`;
    return rows.map((row) => ({
      registration_data: row['registration_data'],
      email_sent: row['email_sent'],
    }));
  }

  return getSqliteDatabase()
    .prepare(
      `SELECT registration_data, email_sent
       FROM registrations
       ORDER BY created_at DESC
       LIMIT 500`,
    )
    .all()
    .map((row) => ({
      registration_data: row['registration_data'],
      email_sent: row['email_sent'],
    }));
}

async function saveMembershipRenewal(
  renewal: MembershipRenewal,
  key: Buffer,
): Promise<void> {
  const existingRenewals = await getMembershipRenewals(key);
  const matchingRenewals = existingRenewals.filter(
    (existing) => existing.membershipNumber === renewal.membershipNumber,
  );
  const storedRenewal: MembershipRenewal = {
    ...renewal,
    id: matchingRenewals[0]?.id ?? renewal.id,
  };
  const renewalData = encryptJson(storedRenewal, key);
  if (process.env['DATABASE_URL']) {
    await ensureNeonSchema();
    if (matchingRenewals.length > 0) {
      await getNeonSql()`UPDATE membership_renewals
        SET created_at = ${renewal.createdAt}, renewal_data = ${renewalData}
        WHERE id = ${storedRenewal.id}`;
      for (const duplicate of matchingRenewals.slice(1)) {
        await getNeonSql()`DELETE FROM membership_renewals
          WHERE id = ${duplicate.id}`;
      }
    } else {
      await getNeonSql()`INSERT INTO membership_renewals
        (id, created_at, renewal_data)
        VALUES (${storedRenewal.id}, ${storedRenewal.createdAt}, ${renewalData})`;
    }
    await setMembershipRenewalStatus(renewal.membershipNumber, true);
    return;
  }

  const db = getSqliteDatabase();
  if (matchingRenewals.length > 0) {
    db.prepare(
      `UPDATE membership_renewals
       SET created_at = ?, renewal_data = ?
       WHERE id = ?`,
    ).run(storedRenewal.createdAt, renewalData, storedRenewal.id);
    for (const duplicate of matchingRenewals.slice(1)) {
      db.prepare('DELETE FROM membership_renewals WHERE id = ?').run(duplicate.id);
    }
  } else {
    db.prepare(
      `INSERT INTO membership_renewals (id, created_at, renewal_data)
       VALUES (?, ?, ?)`,
    ).run(storedRenewal.id, storedRenewal.createdAt, renewalData);
  }
  await setMembershipRenewalStatus(renewal.membershipNumber, true);
}

async function getMembershipDirectoryProfiles(
  key: Buffer,
): Promise<Map<string, MembershipRenewal>> {
  let rows: Record<string, unknown>[];
  if (process.env['DATABASE_URL']) {
    await ensureNeonSchema();
    rows = await getNeonSql()`SELECT membership_number, profile_data
      FROM membership_directory_profiles`;
  } else {
    rows = getSqliteDatabase()
      .prepare(
        `SELECT membership_number, profile_data
         FROM membership_directory_profiles`,
      )
      .all();
  }

  return new Map(
    rows.map((row) => [
      String(row['membership_number']),
      decryptMembershipRenewal(String(row['profile_data']), key),
    ]),
  );
}

async function getMembershipDirectoryProfile(
  key: Buffer,
  membershipNumber: string,
): Promise<MembershipRenewal | undefined> {
  const normalizedMembershipNumber = membershipNumber.trim().replace(/^0+(?=\d)/, '');
  let row: Record<string, unknown> | undefined;
  if (process.env['DATABASE_URL']) {
    await ensureNeonSchema();
    const rows = await getNeonSql()`SELECT profile_data
      FROM membership_directory_profiles
      WHERE membership_number = ${normalizedMembershipNumber}
      LIMIT 1`;
    row = rows[0];
  } else {
    row = getSqliteDatabase()
      .prepare(
        `SELECT profile_data
         FROM membership_directory_profiles
         WHERE membership_number = ?
         LIMIT 1`,
      )
      .get(normalizedMembershipNumber);
  }

  return row
    ? decryptMembershipRenewal(String(row['profile_data']), key)
    : undefined;
}

async function hasRenewalProfile(membershipNumber: string): Promise<boolean> {
  const normalizedMembershipNumber = membershipNumber.trim().replace(/^0+(?=\d)/, '');
  if (!hasPersistentStorageConfigured()) {
    return false;
  }

  if (process.env['DATABASE_URL']) {
    await ensureNeonSchema();
    const rows = await getNeonSql()`SELECT membership_number
      FROM membership_directory_profiles
      WHERE membership_number = ${normalizedMembershipNumber}
      LIMIT 1`;
    return rows.length > 0;
  }

  return Boolean(
    getSqliteDatabase()
      .prepare(
        `SELECT membership_number
         FROM membership_directory_profiles
         WHERE membership_number = ?
         LIMIT 1`,
      )
      .get(normalizedMembershipNumber),
  );
}

async function getMembershipRenewalStatus(
  membershipNumber: string,
): Promise<boolean | null> {
  const normalizedMembershipNumber = membershipNumber.trim().replace(/^0+(?=\d)/, '');
  if (process.env['DATABASE_URL']) {
    await ensureNeonSchema();
    const rows = await getNeonSql()`SELECT renewed
      FROM membership_renewal_status
      WHERE membership_number = ${normalizedMembershipNumber}
      LIMIT 1`;
    const status = rows[0]?.['renewed'];
    return status === undefined ? null : status === true;
  }

  const row = getSqliteDatabase()
    .prepare(
      `SELECT renewed
       FROM membership_renewal_status
       WHERE membership_number = ?
       LIMIT 1`,
    )
    .get(normalizedMembershipNumber);
  return row ? Number(row['renewed']) === 1 : null;
}

async function setMembershipRenewalStatus(
  membershipNumber: string,
  renewed: boolean,
): Promise<void> {
  const normalizedMembershipNumber = membershipNumber.trim().replace(/^0+(?=\d)/, '');
  if (process.env['DATABASE_URL']) {
    await ensureNeonSchema();
    await getNeonSql()`INSERT INTO membership_renewal_status
      (membership_number, renewed)
      VALUES (${normalizedMembershipNumber}, ${renewed})
      ON CONFLICT (membership_number)
      DO UPDATE SET renewed = EXCLUDED.renewed`;
    return;
  }

  getSqliteDatabase()
    .prepare(
      `INSERT INTO membership_renewal_status (membership_number, renewed)
       VALUES (?, ?)
       ON CONFLICT(membership_number)
       DO UPDATE SET renewed = excluded.renewed`,
    )
    .run(normalizedMembershipNumber, renewed ? 1 : 0);
}

async function removeMembershipDirectoryProfile(
  membershipNumber: string,
): Promise<void> {
  const normalizedMembershipNumber = membershipNumber.trim().replace(/^0+(?=\d)/, '');
  if (process.env['DATABASE_URL']) {
    await ensureNeonSchema();
    await getNeonSql()`DELETE FROM membership_directory_profiles
      WHERE membership_number = ${normalizedMembershipNumber}`;
    return;
  }

  getSqliteDatabase()
    .prepare(
      `DELETE FROM membership_directory_profiles
       WHERE membership_number = ?`,
    )
    .run(normalizedMembershipNumber);
}

async function isMembershipRenewedCurrent(membershipNumber: string): Promise<boolean> {
  if (!hasPersistentStorageConfigured()) {
    return isMembershipRenewed(membershipNumber);
  }

  const status = await getMembershipRenewalStatus(membershipNumber);
  if (status !== null) {
    return status;
  }

  const normalizedMembershipNumber = membershipNumber.trim().replace(/^0+(?=\d)/, '');
  const key = getEncryptionKey();
  if (
    key &&
    (await getMembershipRenewals(key)).some(
      (renewal) =>
        renewal.membershipNumber.trim().replace(/^0+(?=\d)/, '') ===
        normalizedMembershipNumber,
    )
  ) {
    return true;
  }

  if (await hasRenewalProfile(normalizedMembershipNumber)) {
    return false;
  }
  return isMembershipRenewed(normalizedMembershipNumber);
}

async function saveMembershipDirectoryProfile(
  renewal: MembershipRenewal,
  key: Buffer,
): Promise<void> {
  const profiles = await getMembershipDirectoryProfiles(key);
  const profile =
    profiles.has(renewal.membershipNumber)
      ? mergeMembershipProfile(
          profiles.get(renewal.membershipNumber)!,
          renewal,
        )
      : renewal;
  const profileData = encryptJson(profile, key);
  if (process.env['DATABASE_URL']) {
    await ensureNeonSchema();
    await getNeonSql()`INSERT INTO membership_directory_profiles
      (membership_number, profile_data)
      VALUES (${renewal.membershipNumber}, ${profileData})
      ON CONFLICT (membership_number)
      DO UPDATE SET profile_data = EXCLUDED.profile_data`;
    return;
  }

  getSqliteDatabase()
    .prepare(
      `INSERT INTO membership_directory_profiles (membership_number, profile_data)
       VALUES (?, ?)
       ON CONFLICT(membership_number)
       DO UPDATE SET profile_data = excluded.profile_data`,
    )
    .run(renewal.membershipNumber, profileData);
}

async function getMembershipRenewals(key: Buffer): Promise<MembershipRenewal[]> {
  if (process.env['DATABASE_URL']) {
    await ensureNeonSchema();
    const rows = await getNeonSql()`SELECT renewal_data
      FROM membership_renewals
      ORDER BY created_at DESC
      LIMIT 1000`;
    return rows.map((row) =>
      decryptMembershipRenewal(String(row['renewal_data']), key),
    );
  }

  return getSqliteDatabase()
    .prepare(
      `SELECT renewal_data
       FROM membership_renewals
       ORDER BY created_at DESC
       LIMIT 1000`,
    )
    .all()
    .map((row) =>
      decryptMembershipRenewal(String(row['renewal_data']), key),
    );
}

async function removeMembershipRenewal(renewalId: string): Promise<boolean> {
    const key = getEncryptionKey();
    if (!key) {
      throw new Error('Membership renewal storage encryption is not configured.');
    }
    const renewal = (await getMembershipRenewals(key)).find(
      (existing) => existing.id === renewalId,
    );
    if (!renewal) {
      return false;
    }

    if (process.env['DATABASE_URL']) {
      await ensureNeonSchema();
      const rows = await getNeonSql()`DELETE FROM membership_renewals
        WHERE id = ${renewalId}
        RETURNING id`;
      if (rows.length === 0) {
        return false;
      }
    } else {
      const result = getSqliteDatabase()
        .prepare('DELETE FROM membership_renewals WHERE id = ?')
        .run(renewalId);
      if (result.changes === 0) {
        return false;
      }
    }

    await setMembershipRenewalStatus(renewal.membershipNumber, false);
    await removeMembershipDirectoryProfile(renewal.membershipNumber);
    return true;
}

async function getMembershipRenewalClearSchedule(): Promise<RegistrationClearSchedule | null> {
    if (process.env['DATABASE_URL']) {
      await ensureNeonSchema();
      const rows = await getNeonSql()`SELECT requested_at, scheduled_for
        FROM membership_renewal_clear_schedule
        WHERE schedule_key = 'all'
        LIMIT 1`;
      const row = rows[0];
      return row
        ? {
            requestedAt: String(row['requested_at']),
            scheduledFor: String(row['scheduled_for']),
          }
        : null;
    }

    const row = getSqliteDatabase()
      .prepare(
        `SELECT requested_at, scheduled_for
         FROM membership_renewal_clear_schedule
         WHERE schedule_key = ?`,
      )
      .get('all');
    return row
      ? {
          requestedAt: String(row['requested_at']),
          scheduledFor: String(row['scheduled_for']),
        }
      : null;
}

async function scheduleMembershipRenewalClear(): Promise<RegistrationClearSchedule | null> {
    const requestedAt = new Date();
    const schedule: RegistrationClearSchedule = {
      requestedAt: requestedAt.toISOString(),
      scheduledFor: new Date(
        requestedAt.getTime() + 10 * 24 * 60 * 60 * 1000,
      ).toISOString(),
    };

    if (process.env['DATABASE_URL']) {
      await ensureNeonSchema();
      const rows = await getNeonSql()`INSERT INTO membership_renewal_clear_schedule
        (schedule_key, requested_at, scheduled_for)
        VALUES ('all', ${schedule.requestedAt}, ${schedule.scheduledFor})
        ON CONFLICT (schedule_key) DO NOTHING
        RETURNING requested_at, scheduled_for`;
      const row = rows[0];
      return row
        ? {
            requestedAt: String(row['requested_at']),
            scheduledFor: String(row['scheduled_for']),
          }
        : null;
    }

    const result = getSqliteDatabase()
      .prepare(
        `INSERT OR IGNORE INTO membership_renewal_clear_schedule
          (schedule_key, requested_at, scheduled_for)
         VALUES (?, ?, ?)`,
      )
      .run('all', schedule.requestedAt, schedule.scheduledFor);
    return result.changes > 0 ? schedule : null;
}

async function cancelMembershipRenewalClear(): Promise<boolean> {
    if (process.env['DATABASE_URL']) {
      await ensureNeonSchema();
      const rows = await getNeonSql()`DELETE FROM membership_renewal_clear_schedule
        WHERE schedule_key = 'all'
        RETURNING schedule_key`;
      return rows.length > 0;
    }

    const result = getSqliteDatabase()
      .prepare(
        'DELETE FROM membership_renewal_clear_schedule WHERE schedule_key = ?',
      )
      .run('all');
    return result.changes > 0;
}

async function clearMembershipRenewalsIfDue(): Promise<number> {
    const now = new Date().toISOString();
    if (process.env['DATABASE_URL']) {
      await ensureNeonSchema();
      const rows = await getNeonSql()`WITH due_schedule AS MATERIALIZED (
          SELECT schedule_key, requested_at
          FROM membership_renewal_clear_schedule
          WHERE schedule_key = 'all' AND scheduled_for <= ${now}
          FOR UPDATE
        ),
        deleted AS (
          DELETE FROM membership_renewals
          USING due_schedule
          WHERE membership_renewals.created_at <= due_schedule.requested_at
          RETURNING membership_renewals.id
        ),
        removed_schedule AS (
          DELETE FROM membership_renewal_clear_schedule
          USING due_schedule
          WHERE membership_renewal_clear_schedule.schedule_key = due_schedule.schedule_key
          RETURNING membership_renewal_clear_schedule.schedule_key
        )
        SELECT COUNT(*)::int AS deleted_count FROM deleted`;
      return Number(rows[0]?.['deleted_count'] ?? 0);
    }

    const localDatabase = getSqliteDatabase();
    localDatabase.exec('BEGIN IMMEDIATE');
    try {
      const schedule = localDatabase
        .prepare(
          `SELECT requested_at, scheduled_for
           FROM membership_renewal_clear_schedule
           WHERE schedule_key = ?`,
        )
        .get('all');
      if (!schedule || String(schedule['scheduled_for']) > now) {
        localDatabase.exec('COMMIT');
        return 0;
      }

      const result = localDatabase
        .prepare('DELETE FROM membership_renewals WHERE created_at <= ?')
        .run(String(schedule['requested_at']));
      localDatabase
        .prepare(
          'DELETE FROM membership_renewal_clear_schedule WHERE schedule_key = ?',
        )
        .run('all');
      localDatabase.exec('COMMIT');
      return Number(result.changes);
    } catch (error) {
      localDatabase.exec('ROLLBACK');
      throw error;
    }
}

async function saveContactDetailsUpdate(
    update: ContactDetailsUpdate,
    key: Buffer,
): Promise<void> {
    const updateData = encryptJson(update, key);
    if (process.env['DATABASE_URL']) {
      await ensureNeonSchema();
      await getNeonSql()`INSERT INTO contact_details_updates
        (id, created_at, update_data)
        VALUES (${update.id}, ${update.createdAt}, ${updateData})`;
      return;
    }
    getSqliteDatabase()
      .prepare(
        `INSERT INTO contact_details_updates (id, created_at, update_data)
         VALUES (?, ?, ?)`,
      )
      .run(update.id, update.createdAt, updateData);
}

async function getContactDetailsUpdates(key: Buffer): Promise<ContactDetailsUpdate[]> {
    if (process.env['DATABASE_URL']) {
      await ensureNeonSchema();
      const rows = await getNeonSql()`SELECT update_data
        FROM contact_details_updates
        ORDER BY created_at DESC
        LIMIT 1000`;
      return rows.map((row) => decryptContactDetailsUpdate(String(row['update_data']), key));
    }
    return getSqliteDatabase()
      .prepare(
        `SELECT update_data
         FROM contact_details_updates
         ORDER BY created_at DESC
         LIMIT 1000`,
      )
      .all()
      .map((row) => decryptContactDetailsUpdate(String(row['update_data']), key));
}

async function removeContactDetailsUpdate(updateId: string): Promise<boolean> {
    if (process.env['DATABASE_URL']) {
      await ensureNeonSchema();
      const rows = await getNeonSql()`DELETE FROM contact_details_updates
        WHERE id = ${updateId}
        RETURNING id`;
      return rows.length > 0;
    }
    const result = getSqliteDatabase()
      .prepare('DELETE FROM contact_details_updates WHERE id = ?')
      .run(updateId);
    return result.changes > 0;
}

async function getContactDetailsClearSchedule(): Promise<RegistrationClearSchedule | null> {
    if (process.env['DATABASE_URL']) {
      await ensureNeonSchema();
      const rows = await getNeonSql()`SELECT requested_at, scheduled_for
        FROM contact_details_clear_schedule
        WHERE schedule_key = 'all'
        LIMIT 1`;
      const row = rows[0];
      return row
        ? { requestedAt: String(row['requested_at']), scheduledFor: String(row['scheduled_for']) }
        : null;
    }
    const row = getSqliteDatabase()
      .prepare(
        `SELECT requested_at, scheduled_for
         FROM contact_details_clear_schedule
         WHERE schedule_key = ?`,
      )
      .get('all');
    return row
      ? { requestedAt: String(row['requested_at']), scheduledFor: String(row['scheduled_for']) }
      : null;
}

async function scheduleContactDetailsClear(): Promise<RegistrationClearSchedule | null> {
    const requestedAt = new Date();
    const schedule: RegistrationClearSchedule = {
      requestedAt: requestedAt.toISOString(),
      scheduledFor: new Date(requestedAt.getTime() + 10 * 24 * 60 * 60 * 1000).toISOString(),
    };
    if (process.env['DATABASE_URL']) {
      await ensureNeonSchema();
      const rows = await getNeonSql()`INSERT INTO contact_details_clear_schedule
        (schedule_key, requested_at, scheduled_for)
        VALUES ('all', ${schedule.requestedAt}, ${schedule.scheduledFor})
        ON CONFLICT (schedule_key) DO NOTHING
        RETURNING requested_at, scheduled_for`;
      const row = rows[0];
      return row
        ? { requestedAt: String(row['requested_at']), scheduledFor: String(row['scheduled_for']) }
        : null;
    }
    const result = getSqliteDatabase()
      .prepare(
        `INSERT OR IGNORE INTO contact_details_clear_schedule
          (schedule_key, requested_at, scheduled_for)
         VALUES (?, ?, ?)`,
      )
      .run('all', schedule.requestedAt, schedule.scheduledFor);
    return result.changes > 0 ? schedule : null;
}

async function cancelContactDetailsClear(): Promise<boolean> {
    if (process.env['DATABASE_URL']) {
      await ensureNeonSchema();
      const rows = await getNeonSql()`DELETE FROM contact_details_clear_schedule
        WHERE schedule_key = 'all'
        RETURNING schedule_key`;
      return rows.length > 0;
    }
    const result = getSqliteDatabase()
      .prepare('DELETE FROM contact_details_clear_schedule WHERE schedule_key = ?')
      .run('all');
    return result.changes > 0;
}

async function clearContactDetailsIfDue(): Promise<number> {
    const now = new Date().toISOString();
    if (process.env['DATABASE_URL']) {
      await ensureNeonSchema();
      const rows = await getNeonSql()`WITH due_schedule AS MATERIALIZED (
          SELECT schedule_key, requested_at
          FROM contact_details_clear_schedule
          WHERE schedule_key = 'all' AND scheduled_for <= ${now}
          FOR UPDATE
        ),
        deleted AS (
          DELETE FROM contact_details_updates
          USING due_schedule
          WHERE contact_details_updates.created_at <= due_schedule.requested_at
          RETURNING contact_details_updates.id
        ),
        removed_schedule AS (
          DELETE FROM contact_details_clear_schedule
          USING due_schedule
          WHERE contact_details_clear_schedule.schedule_key = due_schedule.schedule_key
          RETURNING contact_details_clear_schedule.schedule_key
        )
        SELECT COUNT(*)::int AS deleted_count FROM deleted`;
      return Number(rows[0]?.['deleted_count'] ?? 0);
    }
    const localDatabase = getSqliteDatabase();
    localDatabase.exec('BEGIN IMMEDIATE');
    try {
      const schedule = localDatabase
        .prepare(
          `SELECT requested_at, scheduled_for
           FROM contact_details_clear_schedule
           WHERE schedule_key = ?`,
        )
        .get('all');
      if (!schedule || String(schedule['scheduled_for']) > now) {
        localDatabase.exec('COMMIT');
        return 0;
      }
      const result = localDatabase
        .prepare('DELETE FROM contact_details_updates WHERE created_at <= ?')
        .run(String(schedule['requested_at']));
      localDatabase
        .prepare('DELETE FROM contact_details_clear_schedule WHERE schedule_key = ?')
        .run('all');
      localDatabase.exec('COMMIT');
      return Number(result.changes);
    } catch (error) {
      localDatabase.exec('ROLLBACK');
      throw error;
    }
}

async function getRegistration(
  registrationId: string,
): Promise<StoredRegistrationRow | undefined> {
  if (process.env['DATABASE_URL']) {
    await ensureNeonSchema();
    const rows = await getNeonSql()`SELECT registration_data, email_sent
      FROM registrations
      WHERE id = ${registrationId}
      LIMIT 1`;
    const row = rows[0];
    return row
      ? {
          registration_data: row['registration_data'],
          email_sent: row['email_sent'],
        }
      : undefined;
  }

  const row = getSqliteDatabase()
    .prepare(
      `SELECT registration_data, email_sent
       FROM registrations WHERE id = ?`,
    )
    .get(registrationId);
  return row
    ? {
        registration_data: row['registration_data'],
        email_sent: row['email_sent'],
      }
    : undefined;
}

async function removeRegistration(registrationId: string): Promise<boolean> {
  if (process.env['DATABASE_URL']) {
    await ensureNeonSchema();
    const rows = await getNeonSql()`DELETE FROM registrations
      WHERE id = ${registrationId}
      RETURNING id`;
    return rows.length > 0;
  }

  const result = getSqliteDatabase()
    .prepare('DELETE FROM registrations WHERE id = ?')
    .run(registrationId);
  return result.changes > 0;
}

async function getRegistrationClearSchedule(): Promise<RegistrationClearSchedule | null> {
  if (process.env['DATABASE_URL']) {
    await ensureNeonSchema();
    const rows = await getNeonSql()`SELECT requested_at, scheduled_for
      FROM registration_clear_schedule
      WHERE schedule_key = 'all'
      LIMIT 1`;
    const row = rows[0];
    return row
      ? {
          requestedAt: String(row['requested_at']),
          scheduledFor: String(row['scheduled_for']),
        }
      : null;
  }

  const row = getSqliteDatabase()
    .prepare(
      `SELECT requested_at, scheduled_for
       FROM registration_clear_schedule
       WHERE schedule_key = ?`,
    )
    .get('all');
  return row
    ? {
        requestedAt: String(row['requested_at']),
        scheduledFor: String(row['scheduled_for']),
      }
    : null;
}

async function scheduleRegistrationClear(): Promise<RegistrationClearSchedule | null> {
  const requestedAt = new Date();
  const schedule: RegistrationClearSchedule = {
    requestedAt: requestedAt.toISOString(),
    scheduledFor: new Date(requestedAt.getTime() + 10 * 24 * 60 * 60 * 1000).toISOString(),
  };

  if (process.env['DATABASE_URL']) {
    await ensureNeonSchema();
    const rows = await getNeonSql()`INSERT INTO registration_clear_schedule
      (schedule_key, requested_at, scheduled_for)
      VALUES ('all', ${schedule.requestedAt}, ${schedule.scheduledFor})
      ON CONFLICT (schedule_key) DO NOTHING
      RETURNING requested_at, scheduled_for`;
    const row = rows[0];
    return row
      ? {
          requestedAt: String(row['requested_at']),
          scheduledFor: String(row['scheduled_for']),
        }
      : null;
  }

  const result = getSqliteDatabase()
    .prepare(
      `INSERT OR IGNORE INTO registration_clear_schedule
        (schedule_key, requested_at, scheduled_for)
       VALUES (?, ?, ?)`,
    )
    .run('all', schedule.requestedAt, schedule.scheduledFor);
  return result.changes > 0 ? schedule : null;
}

async function cancelRegistrationClear(): Promise<boolean> {
  if (process.env['DATABASE_URL']) {
    await ensureNeonSchema();
    const rows = await getNeonSql()`DELETE FROM registration_clear_schedule
      WHERE schedule_key = 'all'
      RETURNING schedule_key`;
    return rows.length > 0;
  }

  const result = getSqliteDatabase()
    .prepare('DELETE FROM registration_clear_schedule WHERE schedule_key = ?')
    .run('all');
  return result.changes > 0;
}

async function clearRegistrationsIfDue(): Promise<number> {
  const now = new Date().toISOString();
  if (process.env['DATABASE_URL']) {
    await ensureNeonSchema();
    const rows = await getNeonSql()`WITH due_schedule AS MATERIALIZED (
        SELECT schedule_key, requested_at
        FROM registration_clear_schedule
        WHERE schedule_key = 'all' AND scheduled_for <= ${now}
        FOR UPDATE
      ),
      deleted AS (
        DELETE FROM registrations
        USING due_schedule
        WHERE registrations.created_at <= due_schedule.requested_at
        RETURNING registrations.id
      ),
      removed_schedule AS (
        DELETE FROM registration_clear_schedule
        USING due_schedule
        WHERE registration_clear_schedule.schedule_key = due_schedule.schedule_key
        RETURNING registration_clear_schedule.schedule_key
      )
      SELECT COUNT(*)::int AS deleted_count FROM deleted`;
    return Number(rows[0]?.['deleted_count'] ?? 0);
  }

  const localDatabase = getSqliteDatabase();
  localDatabase.exec('BEGIN IMMEDIATE');
  try {
    const schedule = localDatabase
      .prepare(
        `SELECT requested_at, scheduled_for
         FROM registration_clear_schedule
         WHERE schedule_key = ?`,
      )
      .get('all');
    if (!schedule || String(schedule['scheduled_for']) > now) {
      localDatabase.exec('COMMIT');
      return 0;
    }

    const result = localDatabase
      .prepare('DELETE FROM registrations WHERE created_at <= ?')
      .run(String(schedule['requested_at']));
    localDatabase
      .prepare('DELETE FROM registration_clear_schedule WHERE schedule_key = ?')
      .run('all');
    localDatabase.exec('COMMIT');
    return Number(result.changes);
  } catch (error) {
    localDatabase.exec('ROLLBACK');
    throw error;
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function isGame(value: unknown): value is Game {
  return (
    typeof value === 'string' &&
    (registrationGames as readonly string[]).includes(value)
  );
}

function validPersonName(value: unknown): value is string {
  return (
    typeof value === 'string' &&
    value.trim().length > 0 &&
    value.trim().length <= 120 &&
    !/[\u0000-\u001f\u007f]/.test(value)
  );
}

function normalizePhoneNumber(value: string): string {
  let digits = value.replace(/\D/g, '');
  if (digits.startsWith('0044')) {
    digits = digits.slice(4);
    return `0${digits}`;
  }
  if (digits.startsWith('44')) {
    digits = digits.slice(2);
    return `0${digits}`;
  }
  return digits.startsWith('0') ? digits : `0${digits}`;
}

function getCategory(age: number): string {
  if (age <= 13) {
    return '8–13';
  }
  if (age <= 17) {
    return '14–17';
  }
  return '18+';
}

function validateRegistration(value: unknown):
  | { valid: true; registration: RegistrationInput }
  | { valid: false; message: string } {
  if (!isRecord(value)) {
    return { valid: false, message: 'Registration details are missing or invalid.' };
  }
  const {
    name,
    membershipNumber,
    age,
    phone,
    email,
    guardian,
    games,
    consent,
    paymentConfirmed,
  } = value;
  const emailValue = email === undefined ? '' : email;
  const guardianValue = guardian === undefined ? '' : guardian;
  if (!validPersonName(name)) {
    return { valid: false, message: 'Enter a valid participant name.' };
  }
  if (
    typeof membershipNumber !== 'string' ||
    membershipNumber.trim().length === 0 ||
    membershipNumber.trim().length > 50 ||
    /[\u0000-\u001f\u007f]/.test(membershipNumber)
  ) {
    return { valid: false, message: 'Enter a valid membership number.' };
  }
  if (typeof age !== 'number' || !Number.isInteger(age) || age < 8 || age > 120) {
    return { valid: false, message: 'Participant age must be between 8 and 120.' };
  }
  if (
    typeof phone !== 'string' ||
    phone.trim().length < 7 ||
    phone.trim().length > 30 ||
    !/^[+()\d.\-\s]+$/.test(phone.trim())
  ) {
    return { valid: false, message: 'Enter a valid contact number.' };
  }
  if (
    typeof emailValue !== 'string' ||
    emailValue.length > 254 ||
    (emailValue.length > 0 && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(emailValue))
  ) {
    return { valid: false, message: 'Enter a valid email address.' };
  }
  if (age < 18 && !validPersonName(guardianValue)) {
    return {
      valid: false,
      message: 'A parent or guardian name is required for participants under 18.',
    };
  }
  if (age >= 18 && guardianValue !== '') {
    return { valid: false, message: 'Parent or guardian details are only collected for minors.' };
  }
  const guardianName = typeof guardianValue === 'string' ? guardianValue.trim() : '';
  if (!Array.isArray(games) || games.length === 0 || !games.every(isGame)) {
    return { valid: false, message: 'Select one or more valid games.' };
  }
  const selectedGames = games.filter(isGame);
  if (new Set(selectedGames).size !== selectedGames.length) {
    return { valid: false, message: 'Each game may only be selected once.' };
  }
  if (age < 18 && selectedGames.includes('Cards')) {
    return { valid: false, message: 'Cards is available to participants aged 18 and over.' };
  }
  if (consent !== true) {
    return { valid: false, message: 'Consent is required to submit a registration.' };
  }
  if (paymentConfirmed !== true) {
    return {
      valid: false,
      message: 'Please confirm the £5 registration fee has been paid for this participant.',
    };
  }

  return {
    valid: true,
    registration: {
      name: name.trim(),
      membershipNumber: membershipNumber.trim(),
      age,
      phone: phone.trim(),
      email: emailValue.trim(),
      guardian: age < 18 ? guardianName : '',
      paymentConfirmed,
      games: selectedGames,
    },
  };
}

function createEmailTransporter(): Transporter | null {
  const host = process.env['SMTP_HOST'];
  const user = process.env['SMTP_USER'];
  const pass = process.env['SMTP_PASS'];
  const port = Number(process.env['SMTP_PORT'] || 587);
  if (!host || !user || !pass || !Number.isInteger(port) || port < 1 || port > 65535) {
    return null;
  }

  return nodemailer.createTransport({
    host,
    port,
    secure: process.env['SMTP_SECURE'] === 'true' || port === 465,
    auth: { user, pass },
  });
}

function getEncryptionKey(): Buffer | null {
  const encodedKey = process.env['REGISTRATION_ENCRYPTION_KEY'];
  if (!encodedKey) {
    return null;
  }

  const key = Buffer.from(encodedKey, 'base64');
  return key.length === 32 && key.toString('base64') === encodedKey ? key : null;
}

function getRegistrationConfigurationIssues(): string[] {
  const issues = ['SMTP_HOST', 'SMTP_USER', 'SMTP_PASS'].filter(
    (key) => !process.env[key],
  );
  const port = process.env['SMTP_PORT'];
  if (port && (!Number.isInteger(Number(port)) || Number(port) < 1 || Number(port) > 65535)) {
    issues.push('SMTP_PORT (must be between 1 and 65535)');
  }
  if (!getEncryptionKey()) {
    issues.push('REGISTRATION_ENCRYPTION_KEY (must be 32-byte base64)');
  }
  return issues;
}

function encryptRegistration(registration: Registration, key: Buffer): string {
  return encryptJson(registration, key);
}

function encryptJson(value: unknown, key: Buffer): string {
  const iv = randomBytes(12);
  const cipher = createCipheriv('aes-256-gcm', key, iv);
  const ciphertext = Buffer.concat([
    cipher.update(JSON.stringify(value), 'utf8'),
    cipher.final(),
  ]);
  return JSON.stringify({
    iv: iv.toString('base64'),
    tag: cipher.getAuthTag().toString('base64'),
    ciphertext: ciphertext.toString('base64'),
  });
}

function decryptJson(encodedData: string, key: Buffer): unknown {
  const envelope: unknown = JSON.parse(encodedData);
  if (
    !isRecord(envelope) ||
    typeof envelope['iv'] !== 'string' ||
    typeof envelope['tag'] !== 'string' ||
    typeof envelope['ciphertext'] !== 'string'
  ) {
    throw new Error('Stored encrypted data is invalid.');
  }

  const decipher = createDecipheriv(
    'aes-256-gcm',
    key,
    Buffer.from(envelope['iv'], 'base64'),
  );
  decipher.setAuthTag(Buffer.from(envelope['tag'], 'base64'));
  const plaintext = Buffer.concat([
    decipher.update(Buffer.from(envelope['ciphertext'], 'base64')),
    decipher.final(),
  ]).toString('utf8');
  return JSON.parse(plaintext);
}

function decryptMembershipRenewal(
  encodedData: string,
  key: Buffer,
): MembershipRenewal {
  const value = decryptJson(encodedData, key);
  if (!isMembershipRenewal(value)) {
    throw new Error('Stored membership renewal data is invalid.');
  }
  return value;
}

function isMembershipRenewal(value: unknown): value is MembershipRenewal {
  return (
    isRecord(value) &&
    typeof value['id'] === 'string' &&
    typeof value['createdAt'] === 'string' &&
    (value['mobileNumber'] === undefined ||
      typeof value['mobileNumber'] === 'string') &&
    typeof value['email'] === 'string' &&
    (value['membershipType'] === 'individual' ||
      value['membershipType'] === 'family') &&
    typeof value['membershipNumber'] === 'string' &&
    typeof value['membershipHolderName'] === 'string' &&
    typeof value['memberAge'] === 'number' &&
    typeof value['spouseName'] === 'string' &&
    (value['spouseAge'] === null || typeof value['spouseAge'] === 'number') &&
    Array.isArray(value['children']) &&
    value['children'].every(
      (child) =>
        isRecord(child) &&
        typeof child['name'] === 'string' &&
        (child['age'] === null || typeof child['age'] === 'number'),
    ) &&
    typeof value['otherFamilyMembers'] === 'string' &&
    typeof value['address'] === 'string' &&
    typeof value['postcode'] === 'string' &&
    typeof value['phone'] === 'string' &&
    typeof value['spousePhone'] === 'string' &&
    typeof value['additionalPhones'] === 'string' &&
    value['consent'] === true
  );
}

function decryptContactDetailsUpdate(
  encodedData: string,
  key: Buffer,
): ContactDetailsUpdate {
  const value = decryptJson(encodedData, key);
  if (
    !isRecord(value) ||
    typeof value['id'] !== 'string' ||
    typeof value['createdAt'] !== 'string' ||
    typeof value['phone'] !== 'string' ||
    typeof value['membershipNumber'] !== 'string' ||
    typeof value['name'] !== 'string' ||
    typeof value['email'] !== 'string' ||
    typeof value['address'] !== 'string' ||
    value['consent'] !== true
  ) {
    throw new Error('Stored contact details update data is invalid.');
  }
  return {
    id: value['id'],
    createdAt: value['createdAt'],
    phone: value['phone'],
    membershipNumber: value['membershipNumber'],
    name: value['name'],
    email: value['email'],
    address: value['address'],
    consent: true,
  };
}

function decryptRegistration(
  encodedData: string,
  key: Buffer,
  emailSent: boolean,
): Registration {
  const envelope: unknown = JSON.parse(encodedData);
  if (
    !isRecord(envelope) ||
    typeof envelope['iv'] !== 'string' ||
    typeof envelope['tag'] !== 'string' ||
    typeof envelope['ciphertext'] !== 'string'
  ) {
    throw new Error('Stored registration data is invalid.');
  }

  const decipher = createDecipheriv(
    'aes-256-gcm',
    key,
    Buffer.from(envelope['iv'], 'base64'),
  );
  decipher.setAuthTag(Buffer.from(envelope['tag'], 'base64'));
  const plaintext = Buffer.concat([
    decipher.update(Buffer.from(envelope['ciphertext'], 'base64')),
    decipher.final(),
  ]).toString('utf8');
  const value: unknown = JSON.parse(plaintext);
  if (
    !isRecord(value) ||
    typeof value['id'] !== 'string' ||
    typeof value['createdAt'] !== 'string' ||
    typeof value['name'] !== 'string' ||
    (value['membershipNumber'] !== undefined &&
      typeof value['membershipNumber'] !== 'string') ||
    typeof value['age'] !== 'number' ||
    typeof value['phone'] !== 'string' ||
    typeof value['email'] !== 'string' ||
    typeof value['guardian'] !== 'string' ||
    (value['paymentConfirmed'] !== undefined &&
      typeof value['paymentConfirmed'] !== 'boolean') ||
    !Array.isArray(value['games'])
  ) {
    throw new Error('Stored registration data is invalid.');
  }
  const games = value['games'].filter(
    (choice): choice is GameChoice =>
      isRecord(choice) &&
      isGame(choice['game']) &&
      typeof choice['category'] === 'string',
  );
  if (games.length !== value['games'].length) {
    throw new Error('Stored registration games are invalid.');
  }

  return {
    id: value['id'],
    createdAt: value['createdAt'],
    name: value['name'],
    membershipNumber:
      typeof value['membershipNumber'] === 'string' ? value['membershipNumber'] : '',
    age: value['age'],
    phone: value['phone'],
    email: value['email'],
    guardian: value['guardian'],
    paymentConfirmed: value['paymentConfirmed'] === true,
    games,
    emailSent,
  };
}

function buildRegistrationEmail(registration: Registration): string {
  const gameList = registration.games
    .map(({ game, category }) => `- ${game}: ${category}`)
    .join('\n');
  return [
    'A new MAS Board Games 2026 registration has been submitted.',
    '',
    `Name: ${registration.name}`,
    `Membership number: ${registration.membershipNumber}`,
    `Age on event day: ${registration.age}`,
    `Contact number: ${registration.phone}`,
    `Email: ${registration.email || 'Not provided'}`,
    `Parent / guardian: ${registration.guardian || 'Not applicable'}`,
    `Registration fee: £5 per participant`,
    `Payment confirmation: ${registration.paymentConfirmed ? 'Participant confirmed bank transfer; verify against bank records' : 'Not confirmed'}`,
    '',
    'Selected games:',
    gameList,
    '',
    `Registration ID: ${registration.id}`,
    `Submitted: ${registration.createdAt}`,
  ].join('\n');
}

function buildParticipantConfirmationEmail(registration: Registration): string {
  return [
    `Hello ${registration.name},`,
    '',
    'Your registration for MAS Board Games 2026 has been received.',
    '',
    'Date: 28 November 2026',
    'Time: 12:00 PM–5:00 PM UK time',
    'Venue: Toynbee School, Bodycoats Road, Chandlers Ford, Eastleigh SO53 2PL',
    '',
    'We look forward to seeing you!',
    'Malayalee Association of Southampton',
  ].join('\n');
}

function adminAuthentication(
  req: Request,
  res: Response,
  next: NextFunction,
): void {
  const expectedUsername = process.env['ADMIN_USERNAME'];
  const expectedPassword = process.env['ADMIN_PASSWORD'];
  if (!expectedUsername || !expectedPassword) {
    res.status(503).json({ message: 'The admin dashboard has not been configured.' });
    return;
  }

  const authorization = req.get('authorization') || '';
  if (!authorization.startsWith('Basic ')) {
    res.status(401).json({ message: 'Sign in to view registrations.' });
    return;
  }

  let credentials: string;
  try {
    credentials = Buffer.from(authorization.slice(6), 'base64').toString('utf8');
  } catch {
    res.status(401).json({ message: 'Username or password is incorrect.' });
    return;
  }
  const separator = credentials.indexOf(':');
  const username = separator < 0 ? '' : credentials.slice(0, separator);
  const password = separator < 0 ? '' : credentials.slice(separator + 1);
  const usernameBuffer = Buffer.from(username);
  const passwordBuffer = Buffer.from(password);
  const expectedUsernameBuffer = Buffer.from(expectedUsername);
  const expectedPasswordBuffer = Buffer.from(expectedPassword);
  const usernameMatches =
    usernameBuffer.length === expectedUsernameBuffer.length &&
    timingSafeEqual(usernameBuffer, expectedUsernameBuffer);
  const passwordMatches =
    passwordBuffer.length === expectedPasswordBuffer.length &&
    timingSafeEqual(passwordBuffer, expectedPasswordBuffer);

  if (!usernameMatches || !passwordMatches) {
    res.status(401).json({ message: 'Username or password is incorrect.' });
    return;
  }
  next();
}

function cronAuthentication(
  req: Request,
  res: Response,
  next: NextFunction,
): void {
  const expectedSecret = process.env['CRON_SECRET'];
  if (!expectedSecret) {
    res.status(503).json({ message: 'Scheduled clear is not configured.' });
    return;
  }

  const authorization = req.get('authorization') || '';
  const providedSecret = authorization.startsWith('Bearer ')
    ? authorization.slice(7)
    : '';
  const providedBuffer = Buffer.from(providedSecret);
  const expectedBuffer = Buffer.from(expectedSecret);
  if (
    providedBuffer.length !== expectedBuffer.length ||
    !timingSafeEqual(providedBuffer, expectedBuffer)
  ) {
    res.status(401).json({ message: 'Unauthorized.' });
    return;
  }
  next();
}

function readRegistration(
  row: StoredRegistrationRow,
  key: Buffer,
): Registration {
  return decryptRegistration(
    String(row['registration_data']),
    key,
    row['email_sent'] === true || Number(row['email_sent']) === 1,
  );
}

app.post('/api/registrations', async (req, res, next) => {
  const validation = validateRegistration(req.body);
  if (!validation.valid) {
    res.status(400).json({ message: validation.message });
    return;
  }

  try {
    if (!(await isMembershipRenewedCurrent(validation.registration.membershipNumber))) {
      res.status(403).json({
        message: Object.hasOwn(
          membershipDirectory,
          validation.registration.membershipNumber.trim().replace(/^0+(?=\d)/, ''),
        )
          ? 'Your MAS membership must be renewed before registering for board games.'
          : 'Please register your MAS membership before registering for board games.',
      });
      return;
    }
  } catch (error) {
    next(error);
    return;
  }

  const transporter = createEmailTransporter();
  const encryptionKey = getEncryptionKey();
  if (!transporter || !encryptionKey) {
    const configurationIssues = getRegistrationConfigurationIssues();
    res.status(503).json({
      message: `Registration is not open yet. Configure these Vercel environment variables: ${configurationIssues.join(', ') || 'SMTP settings'}.`,
    });
    return;
  }
  if (!hasPersistentStorageConfigured()) {
    res.status(503).json({
      message: 'Registration storage is not configured. Set DATABASE_URL before accepting registrations.',
    });
    return;
  }

  try {
    const id = randomUUID();
    const createdAt = new Date().toISOString();
    const { registration } = validation;
    const games = registration.games.map((game) => ({
      game,
      category: game === 'Cards' ? '18+' : getCategory(registration.age),
    }));
    const savedRegistration: Registration = {
      ...registration,
      id,
      createdAt,
      games,
      emailSent: false,
    };
    await saveRegistration(savedRegistration, encryptionKey);

    try {
      await transporter.sendMail({
        from: process.env['SMTP_FROM'] || process.env['SMTP_USER'],
        to: 'masouthampton@gmail.com',
        subject: 'New MAS Board Games 2026 registration',
        text: buildRegistrationEmail(savedRegistration),
      });
      await setEmailSent(id);
    } catch (error) {
      console.error(`Email notification failed for registration ${id}.`, error);
      res.status(502).json({
        message:
          'Your registration was saved, but MAS could not be notified by email. Please contact masouthampton@gmail.com and do not submit again.',
        registrationSaved: true,
      });
      return;
    }

    let confirmationEmailSent = false;
    if (registration.email) {
      try {
        await transporter.sendMail({
          from: process.env['SMTP_FROM'] || process.env['SMTP_USER'],
          to: registration.email,
          subject: 'Your MAS Board Games 2026 registration',
          text: buildParticipantConfirmationEmail(savedRegistration),
        });
        confirmationEmailSent = true;
      } catch (error) {
        console.error(`Participant confirmation email failed for registration ${id}.`, error);
      }
    }

    const message =
      registration.email && !confirmationEmailSent
        ? `Thank you, ${registration.name}! Your registration has been saved and MAS notified, but we could not send your confirmation email. Please contact masouthampton@gmail.com if you need the event details.`
        : `Thank you, ${registration.name}! Your registration has been submitted to MAS.${confirmationEmailSent ? ' A confirmation email with the event time and location has been sent.' : ''}`;
    res.status(201).json({ message });
  } catch (error) {
    next(error);
  }
});

app.post('/api/membership-lookup', async (req, res, next) => {
  if (!isRecord(req.body) || typeof req.body['membershipNumber'] !== 'string') {
    res.status(400).json({ message: 'Enter a valid membership number.' });
    return;
  }

  const membershipNumber = req.body['membershipNumber'].trim();
  if (!membershipNumber || membershipNumber.length > 50) {
    res.status(400).json({ message: 'Enter a valid membership number.' });
    return;
  }

  const normalizedMembershipNumber = membershipNumber.replace(/^0+(?=\d)/, '');
  try {
    const renewed = await isMembershipRenewedCurrent(normalizedMembershipNumber);
    res.setHeader('Cache-Control', 'no-store');
    const member = membershipDirectory[normalizedMembershipNumber];
    if (!member) {
      res.status(404).json({
        message: 'No member found for that number.',
        renewed,
      });
      return;
    }

    const encryptionKey = getEncryptionKey();
    const profile =
      encryptionKey && hasPersistentStorageConfigured()
        ? await getMembershipDirectoryProfile(encryptionKey, normalizedMembershipNumber)
        : undefined;
    res.json({
      names: getMembershipNames(
        normalizedMembershipNumber,
        member.names,
        profile?.membershipType === 'family' ? profile.spouseName : undefined,
        profile?.membershipType === 'family'
          ? profile.children.map((child) => child.name)
          : [],
      ),
      renewed,
    });
  } catch (error) {
    next(error);
  }
});

app.post('/api/membership-phone-lookup', async (req, res, next) => {
  if (!isRecord(req.body) || typeof req.body['phone'] !== 'string') {
    res.status(400).json({ message: 'Enter a valid mobile number.' });
    return;
  }

  const normalizedPhone = normalizePhoneNumber(req.body['phone']);
  if (normalizedPhone.length < 7 || normalizedPhone.length > 15) {
    res.status(400).json({ message: 'Enter a valid mobile number.' });
    return;
  }

  try {
    const encryptionKey = getEncryptionKey();
    const profiles =
      encryptionKey && hasPersistentStorageConfigured()
        ? await getMembershipDirectoryProfiles(encryptionKey)
        : new Map<string, MembershipRenewal>();
    const matches = Object.entries(membershipDirectory)
      .filter(([membershipNumber, member]) => {
        const profile = profiles.get(membershipNumber);
        const spousePhone =
          profile?.membershipType === 'family' ? profile.spousePhone : undefined;
        return getMembershipPhoneNumbers(
          membershipNumber,
          member.phone,
          spousePhone,
        ).some((phone) => normalizePhoneNumber(phone) === normalizedPhone);
      })
      .map(([membershipNumber, member]) => {
        const profile = profiles.get(membershipNumber);
        return {
          membershipNumber,
          names: getMembershipNames(
            membershipNumber,
            member.names,
            profile?.membershipType === 'family' ? profile.spouseName : undefined,
            profile?.membershipType === 'family'
              ? profile.children.map((child) => child.name)
              : [],
          ),
        };
      });

    res.setHeader('Cache-Control', 'no-store');
    if (matches.length === 0) {
      res.status(404).json({ message: 'No member found for that mobile number.' });
      return;
    }
    res.json({ matches });
  } catch (error) {
    next(error);
  }
});

app.post('/api/contact-details-updates', async (req, res, next) => {
  const value = req.body;
  if (
    !isRecord(value) ||
    typeof value['phone'] !== 'string' ||
    typeof value['membershipNumber'] !== 'string' ||
    typeof value['name'] !== 'string' ||
    typeof value['email'] !== 'string' ||
    typeof value['address'] !== 'string' ||
    value['consent'] !== true
  ) {
    res.status(400).json({ message: 'Please complete all required contact-detail fields.' });
    return;
  }

  const phone = value['phone'].trim();
  const membershipNumber = value['membershipNumber'].trim().replace(/^0+(?=\d)/, '');
  const name = value['name'].trim();
  const email = value['email'].trim();
  const address = value['address'].trim();
  const normalizedPhone = normalizePhoneNumber(phone);
  const validEmail = /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email);
  const directoryMember = membershipDirectory[membershipNumber];
  const phoneMatchesMembership =
    !!directoryMember &&
    getMembershipPhoneNumbers(membershipNumber, directoryMember.phone).some(
      (directoryPhone) => normalizePhoneNumber(directoryPhone) === normalizedPhone,
    );
  const directoryNames = directoryMember
    ? getMembershipNames(membershipNumber, directoryMember.names).join(', ')
    : '';
  const nameMatchesMembership = Boolean(directoryNames) && name === directoryNames;
  if (
    normalizedPhone.length < 7 ||
    normalizedPhone.length > 15 ||
    !name ||
    name.length > 500 ||
    !nameMatchesMembership ||
    !validEmail ||
    email.length > 254 ||
    !address ||
    address.length > 500 ||
    !phoneMatchesMembership
  ) {
    res.status(400).json({
      message:
        'The name, phone number, and membership number must match a member in the directory. Please find your details again.',
    });
    return;
  }

  const encryptionKey = getEncryptionKey();
  if (!encryptionKey || !hasPersistentStorageConfigured()) {
    res.status(503).json({ message: 'Secure contact-detail storage is not configured.' });
    return;
  }
  try {
    const update: ContactDetailsUpdate = {
      id: randomUUID(),
      createdAt: new Date().toISOString(),
      phone,
      membershipNumber,
      name,
      email,
      address,
      consent: true,
    };
    await saveContactDetailsUpdate(update, encryptionKey);
    res.status(201).json({
      message: 'Thank you. Your contact details have been submitted.',
    });
  } catch (error) {
    next(error);
  }
});

app.post('/api/membership-renewals', async (req, res, next) => {
  const value = req.body;
  if (
    !isRecord(value) ||
    typeof value['mobileNumber'] !== 'string' ||
    typeof value['membershipNumber'] !== 'string' ||
    typeof value['membershipHolderName'] !== 'string' ||
    typeof value['membershipType'] !== 'string' ||
    typeof value['email'] !== 'string' ||
    typeof value['memberAge'] !== 'number' ||
    typeof value['spouseName'] !== 'string' ||
    (value['spouseAge'] !== null && typeof value['spouseAge'] !== 'number') ||
    !Array.isArray(value['children']) ||
    value['children'].length !== 4 ||
    !value['children'].every(
      (child) =>
        isRecord(child) &&
        typeof child['name'] === 'string' &&
        (child['age'] === null || typeof child['age'] === 'number'),
    ) ||
    typeof value['otherFamilyMembers'] !== 'string' ||
    typeof value['address'] !== 'string' ||
    typeof value['postcode'] !== 'string' ||
    typeof value['phone'] !== 'string' ||
    typeof value['spousePhone'] !== 'string' ||
    typeof value['additionalPhones'] !== 'string' ||
    value['consent'] !== true
  ) {
    res.status(400).json({ message: 'Please complete all required renewal fields.' });
    return;
  }

  const membershipNumber = value['membershipNumber'].trim().replace(/^0+(?=\d)/, '');
  const membershipHolderName = value['membershipHolderName'].trim();
  const mobileNumber = value['mobileNumber'].trim();
  const normalizedMobileNumber = normalizePhoneNumber(mobileNumber);
  const email = value['email'].trim();
  const postcode = value['postcode'].trim();
  const phone = value['phone'].trim();
  const isValidAge = (age: unknown): age is number =>
    typeof age === 'number' && Number.isInteger(age) && age >= 0 && age <= 120;
  const directoryMember = membershipDirectory[membershipNumber];
  const holderNameMatches =
    !!directoryMember &&
    getMembershipNames(membershipNumber, directoryMember.names).includes(
      membershipHolderName,
    );
  const mobileMatchesMembership =
    !!directoryMember &&
    getMembershipPhoneNumbers(membershipNumber, directoryMember.phone).some(
      (directoryPhone) =>
        normalizePhoneNumber(directoryPhone) === normalizedMobileNumber,
    );
  if (
    !Object.hasOwn(membershipDirectory, membershipNumber) ||
    !holderNameMatches ||
    normalizedMobileNumber.length < 7 ||
    normalizedMobileNumber.length > 15 ||
    !mobileMatchesMembership
  ) {
    res.status(400).json({
      message:
        'The mobile number, membership number, and membership holder name must match the member directory.',
    });
    return;
  }

  if (
    membershipHolderName.length > 120 ||
    !isValidAge(value['memberAge']) ||
    (value['membershipType'] !== 'individual' &&
      value['membershipType'] !== 'family') ||
    !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email) ||
    email.length > 254 ||
    (value['spouseAge'] !== null && !isValidAge(value['spouseAge'])) ||
    !value['children'].every(
      (child) =>
        child['name'].trim().length <= 120 &&
        (child['age'] === null || isValidAge(child['age'])),
    ) ||
    value['otherFamilyMembers'].length > 1000 ||
    value['address'].length > 500 ||
    postcode.length < 3 ||
    postcode.length > 12 ||
    phone.length < 7 ||
    phone.length > 30 ||
    value['spousePhone'].length > 30 ||
    value['additionalPhones'].length > 500
  ) {
    res.status(400).json({
      message: 'Please check the membership number and required field formats.',
    });
    return;
  }

  const encryptionKey = getEncryptionKey();
  if (!encryptionKey || !hasPersistentStorageConfigured()) {
    res.status(503).json({ message: 'Secure renewal storage is not configured.' });
    return;
  }

  try {
    const renewal: MembershipRenewal = {
      id: randomUUID(),
      createdAt: new Date().toISOString(),
      mobileNumber,
      email,
      membershipType: value['membershipType'],
      membershipNumber,
      membershipHolderName,
      memberAge: value['memberAge'],
      spouseName: value['spouseName'].trim(),
      spouseAge: value['spouseAge'],
      children: value['children'].map((child) => ({
        name: child['name'].trim(),
        age: child['age'],
      })),
      otherFamilyMembers: value['otherFamilyMembers'].trim(),
      address: value['address'].trim(),
      postcode,
      phone,
      spousePhone: value['spousePhone'].trim(),
      additionalPhones: value['additionalPhones'].trim(),
      consent: true,
    };
    await saveMembershipRenewal(renewal, encryptionKey);
    await saveMembershipDirectoryProfile(renewal, encryptionKey);
    res.status(201).json({
      message: 'Thank you. Your membership renewal details have been submitted.',
    });
  } catch (error) {
    next(error);
  }
});

app.get('/api/admin/registrations', adminAuthentication, async (_req, res, next) => {
  try {
    const encryptionKey = getEncryptionKey();
    if (!encryptionKey || !hasPersistentStorageConfigured()) {
      res.status(503).json({ message: 'The secure storage service is not configured.' });
      return;
    }
    const rows = await getRegistrations();
    res.setHeader('Cache-Control', 'no-store');
    res.json(rows.map((row) => readRegistration(row, encryptionKey)));
  } catch (error) {
    next(error);
  }
});

app.get('/api/admin/members', adminAuthentication, async (_req, res, next) => {
  try {
    const encryptionKey = getEncryptionKey();
    const profiles =
      encryptionKey && hasPersistentStorageConfigured()
        ? await getMembershipDirectoryProfiles(encryptionKey)
        : new Map<string, MembershipRenewal>();
    const members = Object.entries(membershipDirectory)
      .sort(([left], [right]) => Number(left) - Number(right))
      .map(([membershipNumber, member]) => {
        const profile = profiles.get(membershipNumber);
        const names = profile?.spouseName
          ? [...member.names, profile.spouseName]
          : [...getMembershipNames(membershipNumber, member.names)];
        for (const child of profile?.children ?? []) {
          if (child.name && !names.includes(child.name)) {
            names.push(child.name);
          }
        }

        const directoryPhones = getMembershipPhoneNumbers(
          membershipNumber,
          member.phone,
        );
        const phones = profile
          ? [
              profile.phone || directoryPhones[0] || '',
              profile.spousePhone || directoryPhones[1] || '',
              profile.additionalPhones,
            ].filter(Boolean)
          : directoryPhones;

        return {
          membershipNumber,
          names,
          phones,
          email: profile?.email || member.email || '',
          address: [profile?.address, profile?.postcode].filter(Boolean).join(', '),
          addressUpdatedAt: profile?.createdAt ?? '',
          renewalDetails: profile
            ? {
                membershipType: profile.membershipType,
                memberAge: profile.memberAge,
                spouseName: profile.spouseName,
                spouseAge: profile.spouseAge,
                children: profile.children,
                otherFamilyMembers: profile.otherFamilyMembers,
                postcode: profile.postcode,
                spousePhone: profile.spousePhone,
                additionalPhones: profile.additionalPhones,
              }
            : null,
        };
      });

    res.setHeader('Cache-Control', 'no-store');
    res.json(members);
  } catch (error) {
    next(error);
  }
});

app.get(
  '/api/admin/membership-renewals',
  adminAuthentication,
  async (_req, res, next) => {
    try {
      const encryptionKey = getEncryptionKey();
      if (!encryptionKey || !hasPersistentStorageConfigured()) {
        res.status(503).json({ message: 'The secure storage service is not configured.' });
        return;
      }
      const renewals = await getMembershipRenewals(encryptionKey);
      const latestRenewals = new Map<string, MembershipRenewal>();
      for (const renewal of renewals) {
        if (!latestRenewals.has(renewal.membershipNumber)) {
          latestRenewals.set(renewal.membershipNumber, renewal);
        }
      }
      res.setHeader('Cache-Control', 'no-store');
      res.json([...latestRenewals.values()]);
    } catch (error) {
      next(error);
    }
  },
);

app.get(
  '/api/admin/membership-renewals/clear-schedule',
  adminAuthentication,
  async (_req, res, next) => {
    try {
      if (!hasPersistentStorageConfigured()) {
        res.status(503).json({ message: 'The secure storage service is not configured.' });
        return;
      }
      res.setHeader('Cache-Control', 'no-store');
      res.json({ schedule: await getMembershipRenewalClearSchedule() });
    } catch (error) {
      next(error);
    }
  },
);

app.post(
  '/api/admin/membership-renewals/clear-schedule',
  adminAuthentication,
  async (_req, res, next) => {
    try {
      if (!hasPersistentStorageConfigured()) {
        res.status(503).json({ message: 'The secure storage service is not configured.' });
        return;
      }
      if (process.env['VERCEL'] && !process.env['CRON_SECRET']) {
        res.status(503).json({
          message: 'Scheduled clear is not configured. Set CRON_SECRET in Vercel.',
        });
        return;
      }
      const schedule = await scheduleMembershipRenewalClear();
      if (!schedule) {
        res.status(409).json({
          message: 'A renewal clear is already scheduled.',
          schedule: await getMembershipRenewalClearSchedule(),
        });
        return;
      }
      res.status(201).json({
        message: 'All membership renewals present now are scheduled to be cleared in 10 days.',
        schedule,
      });
    } catch (error) {
      next(error);
    }
  },
);

app.delete(
  '/api/admin/membership-renewals/clear-schedule',
  adminAuthentication,
  async (_req, res, next) => {
    try {
      if (!hasPersistentStorageConfigured()) {
        res.status(503).json({ message: 'The secure storage service is not configured.' });
        return;
      }
      if (!(await cancelMembershipRenewalClear())) {
        res.status(404).json({ message: 'There is no renewal clear scheduled to cancel.' });
        return;
      }
      res.setHeader('Cache-Control', 'no-store');
      res.json({ message: 'Scheduled renewal clear cancelled.' });
    } catch (error) {
      next(error);
    }
  },
);

app.delete(
  '/api/admin/membership-renewals/:id',
  adminAuthentication,
  async (req, res, next) => {
    const renewalId = req.params['id'];
    if (
      typeof renewalId !== 'string' ||
      !/^[\da-f]{8}(?:-[\da-f]{4}){3}-[\da-f]{12}$/i.test(renewalId)
    ) {
      res.status(400).json({ message: 'Membership renewal ID is invalid.' });
      return;
    }

    try {
      if (!(await removeMembershipRenewal(renewalId))) {
        res.status(404).json({ message: 'Membership renewal not found.' });
        return;
      }
      res.setHeader('Cache-Control', 'no-store');
      res.status(204).end();
    } catch (error) {
      next(error);
    }
  },
);

app.get(
  '/api/admin/registrations/clear-schedule',
  adminAuthentication,
  async (_req, res, next) => {
    try {
      if (!hasPersistentStorageConfigured()) {
        res.status(503).json({ message: 'The secure storage service is not configured.' });
        return;
      }
      res.setHeader('Cache-Control', 'no-store');
      res.json({ schedule: await getRegistrationClearSchedule() });
    } catch (error) {
      next(error);
    }
  },
);

app.post(
  '/api/admin/registrations/clear-schedule',
  adminAuthentication,
  async (_req, res, next) => {
    try {
      if (!hasPersistentStorageConfigured()) {
        res.status(503).json({ message: 'The secure storage service is not configured.' });
        return;
      }
      if (process.env['VERCEL'] && !process.env['CRON_SECRET']) {
        res.status(503).json({ message: 'Scheduled clear is not configured. Set CRON_SECRET in Vercel.' });
        return;
      }
      const schedule = await scheduleRegistrationClear();
      if (!schedule) {
        res.status(409).json({
          message: 'A clear is already scheduled.',
          schedule: await getRegistrationClearSchedule(),
        });
        return;
      }
      res.status(201).json({
        message: 'All registrations present now are scheduled to be cleared in 10 days.',
        schedule,
      });
    } catch (error) {
      next(error);
    }
  },
);

app.delete(
  '/api/admin/registrations/clear-schedule',
  adminAuthentication,
  async (_req, res, next) => {
    try {
      if (!hasPersistentStorageConfigured()) {
        res.status(503).json({ message: 'The secure storage service is not configured.' });
        return;
      }
      if (!(await cancelRegistrationClear())) {
        res.status(404).json({ message: 'There is no scheduled clear to cancel.' });
        return;
      }
      res.setHeader('Cache-Control', 'no-store');
      res.json({ message: 'Scheduled clear cancelled.' });
    } catch (error) {
      next(error);
    }
  },
);

app.get(
  '/api/cron/clear-registrations',
  cronAuthentication,
  async (_req, res, next) => {
    try {
      if (!hasPersistentStorageConfigured()) {
        res.status(503).json({ message: 'The secure storage service is not configured.' });
        return;
      }
      const deletedCount = await clearRegistrationsIfDue();
      const deletedRenewalCount = await clearMembershipRenewalsIfDue();
      const deletedContactDetailsCount = await clearContactDetailsIfDue();
      res.setHeader('Cache-Control', 'no-store');
      res.json({
        cleared:
          deletedCount > 0 ||
          deletedRenewalCount > 0 ||
          deletedContactDetailsCount > 0,
        deletedCount,
        deletedRenewalCount,
        deletedContactDetailsCount,
      });
    } catch (error) {
      next(error);
    }
  },
);

app.delete(
  '/api/admin/registrations/:id',
  adminAuthentication,
  async (req, res, next) => {
    const registrationId = req.params['id'];
    if (
      typeof registrationId !== 'string' ||
      !/^[\da-f]{8}(?:-[\da-f]{4}){3}-[\da-f]{12}$/i.test(registrationId)
    ) {
      res.status(400).json({ message: 'Registration ID is invalid.' });
      return;
    }

    try {
      if (!(await removeRegistration(registrationId))) {
        res.status(404).json({ message: 'Registration not found.' });
        return;
      }
      res.setHeader('Cache-Control', 'no-store');
      res.status(204).end();
    } catch (error) {
      next(error);
    }
  },
);

app.get(
  '/api/admin/contact-details-updates',
  adminAuthentication,
  async (_req, res, next) => {
    try {
      const encryptionKey = getEncryptionKey();
      if (!encryptionKey || !hasPersistentStorageConfigured()) {
        res.status(503).json({ message: 'The secure storage service is not configured.' });
        return;
      }
      res.setHeader('Cache-Control', 'no-store');
      res.json(await getContactDetailsUpdates(encryptionKey));
    } catch (error) {
      next(error);
    }
  },
);

app.get(
  '/api/admin/contact-details-updates/clear-schedule',
  adminAuthentication,
  async (_req, res, next) => {
    try {
      if (!hasPersistentStorageConfigured()) {
        res.status(503).json({ message: 'The secure storage service is not configured.' });
        return;
      }
      res.setHeader('Cache-Control', 'no-store');
      res.json({ schedule: await getContactDetailsClearSchedule() });
    } catch (error) {
      next(error);
    }
  },
);

app.post(
  '/api/admin/contact-details-updates/clear-schedule',
  adminAuthentication,
  async (_req, res, next) => {
    try {
      if (!hasPersistentStorageConfigured()) {
        res.status(503).json({ message: 'The secure storage service is not configured.' });
        return;
      }
      if (process.env['VERCEL'] && !process.env['CRON_SECRET']) {
        res.status(503).json({
          message: 'Scheduled clear is not configured. Set CRON_SECRET in Vercel.',
        });
        return;
      }
      const schedule = await scheduleContactDetailsClear();
      if (!schedule) {
        res.status(409).json({
          message: 'A contact-details clear is already scheduled.',
          schedule: await getContactDetailsClearSchedule(),
        });
        return;
      }
      res.status(201).json({
        message: 'Contact-detail submissions present now are scheduled to be cleared in 10 days.',
        schedule,
      });
    } catch (error) {
      next(error);
    }
  },
);

app.delete(
  '/api/admin/contact-details-updates/clear-schedule',
  adminAuthentication,
  async (_req, res, next) => {
    try {
      if (!hasPersistentStorageConfigured()) {
        res.status(503).json({ message: 'The secure storage service is not configured.' });
        return;
      }
      if (!(await cancelContactDetailsClear())) {
        res.status(404).json({ message: 'There is no contact-details clear scheduled to cancel.' });
        return;
      }
      res.setHeader('Cache-Control', 'no-store');
      res.json({ message: 'Scheduled contact-details clear cancelled.' });
    } catch (error) {
      next(error);
    }
  },
);

app.delete(
  '/api/admin/contact-details-updates/:id',
  adminAuthentication,
  async (req, res, next) => {
    const updateId = req.params['id'];
    if (
      typeof updateId !== 'string' ||
      !/^[\da-f]{8}(?:-[\da-f]{4}){3}-[\da-f]{12}$/i.test(updateId)
    ) {
      res.status(400).json({ message: 'Contact-details update ID is invalid.' });
      return;
    }
    try {
      if (!(await removeContactDetailsUpdate(updateId))) {
        res.status(404).json({ message: 'Contact-details update not found.' });
        return;
      }
      res.setHeader('Cache-Control', 'no-store');
      res.status(204).end();
    } catch (error) {
      next(error);
    }
  },
);

app.post(
  '/api/admin/registrations/:id/email',
  adminAuthentication,
  async (req, res, next) => {
    try {
      const transporter = createEmailTransporter();
      const encryptionKey = getEncryptionKey();
      if (!transporter || !encryptionKey) {
        res.status(503).json({
          message: 'The committee email or secure storage service is not configured.',
        });
        return;
      }
      const registrationId = req.params['id'];
      if (typeof registrationId !== 'string') {
        res.status(404).json({ message: 'Registration not found.' });
        return;
      }
      if (!hasPersistentStorageConfigured()) {
        res.status(503).json({ message: 'The secure storage service is not configured.' });
        return;
      }
      const row = await getRegistration(registrationId);
      if (!row) {
        res.status(404).json({ message: 'Registration not found.' });
        return;
      }
      const registration = readRegistration(row, encryptionKey);
      await transporter.sendMail({
        from: process.env['SMTP_FROM'] || process.env['SMTP_USER'],
        to: 'masouthampton@gmail.com',
        subject: 'New MAS Board Games 2026 registration',
        text: buildRegistrationEmail(registration),
      });
      await setEmailSent(registration.id);
      res.json({ message: 'Email notification sent.' });
    } catch (error) {
      console.error(`Email retry failed for registration ${req.params['id']}.`, error);
      res.status(502).json({ message: 'The email notification could not be sent.' });
    }
  },
);

/**
 * Serve static files from /browser
 */
app.use(
  express.static(browserDistFolder, {
    maxAge: '1y',
    index: false,
    redirect: false,
  }),
);

/**
 * Handle all other requests by rendering the Angular application.
 */
app.use((req, res, next) => {
  angularApp
    .handle(req)
    .then((response) =>
      response ? writeResponseToNodeResponse(response, res) : next(),
    )
    .catch(next);
});

app.use(
  (
    error: unknown,
    req: Request,
    res: Response,
    next: NextFunction,
  ) => {
    if (res.headersSent) {
      next(error);
      return;
    }
    if (req.path.startsWith('/api/')) {
      console.error('Unhandled API request error.', error);
      const responseStatus =
        isRecord(error) &&
        typeof error['status'] === 'number' &&
        error['status'] >= 400 &&
        error['status'] < 500
          ? error['status']
          : 500;
      res.status(responseStatus).json({
        message:
          responseStatus < 500
            ? 'The API request is invalid.'
            : 'The API could not complete this request.',
      });
      return;
    }
    next(error);
  },
);

/**
 * Start the server if this module is the main entry point.
 * The server listens on the port defined by the `PORT` environment variable, or defaults to 4000.
 */
if (isMainModule(import.meta.url)) {
  const port = process.env['PORT'] || 4000;
  app.listen(port, (error) => {
    if (error) {
      throw error;
    }

    console.log(`Node Express server listening on http://localhost:${port}`);
  });
}

/**
 * Request handler used by the Angular CLI (for dev-server and during build) or Firebase Cloud Functions.
 */
export const reqHandler = createNodeRequestHandler(app);
