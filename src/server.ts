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

const browserDistFolder = join(import.meta.dirname, '../browser');
const require = createRequire(import.meta.url);
const registrationGames = ['Carroms', 'Chess', 'PlayStation', 'Cards'] as const;
type Game = (typeof registrationGames)[number];
type GameChoice = { game: Game; category: string };
type Registration = {
  id: string;
  createdAt: string;
  name: string;
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
  const { name, age, phone, email, guardian, games, consent, paymentConfirmed } = value;
  const emailValue = email === undefined ? '' : email;
  const guardianValue = guardian === undefined ? '' : guardian;
  if (!validPersonName(name)) {
    return { valid: false, message: 'Enter a valid participant name.' };
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
  const iv = randomBytes(12);
  const cipher = createCipheriv('aes-256-gcm', key, iv);
  const ciphertext = Buffer.concat([
    cipher.update(JSON.stringify(registration), 'utf8'),
    cipher.final(),
  ]);
  return JSON.stringify({
    iv: iv.toString('base64'),
    tag: cipher.getAuthTag().toString('base64'),
    ciphertext: ciphertext.toString('base64'),
  });
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

function buildParticipantConfirmationSms(registration: Registration): string {
  const firstName = registration.name.trim().split(/\s+/)[0];
  return `MAS: Thanks, ${firstName}. Board Games 2026: 28 Nov 2026, 12:00 PM-5:00 PM at Toynbee School, Bodycoats Rd, Chandlers Ford, Eastleigh SO53 2PL.`;
}

function toInternationalPhoneNumber(phone: string): string {
  const compact = phone.replace(/[\s().-]/g, '');
  if (compact.startsWith('+')) {
    return compact;
  }
  if (compact.startsWith('00')) {
    return `+${compact.slice(2)}`;
  }
  if (compact.startsWith('0')) {
    return `+44${compact.slice(1)}`;
  }
  return `+${compact}`;
}

async function sendParticipantConfirmationSms(registration: Registration): Promise<void> {
  const body = new URLSearchParams({
    phone: toInternationalPhoneNumber(registration.phone),
    message: buildParticipantConfirmationSms(registration),
    key: 'textbelt',
  });
  const response = await fetch('https://textbelt.com/text', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body,
    signal: AbortSignal.timeout(10_000),
  });
  let result: { success?: boolean; error?: string };
  try {
    result = await response.json();
  } catch {
    throw new Error(`The SMS provider returned an invalid response (HTTP ${response.status}).`);
  }
  if (!response.ok || result.success !== true) {
    throw new Error(result.error || `The SMS provider returned HTTP ${response.status}.`);
  }
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

    const confirmationFailures: string[] = [];
    if (registration.email) {
      try {
        await transporter.sendMail({
          from: process.env['SMTP_FROM'] || process.env['SMTP_USER'],
          to: registration.email,
          subject: 'Your MAS Board Games 2026 registration',
          text: buildParticipantConfirmationEmail(savedRegistration),
        });
      } catch (error) {
        console.error(`Participant confirmation email failed for registration ${id}.`, error);
        confirmationFailures.push('confirmation email');
      }
    }
    try {
      await sendParticipantConfirmationSms(savedRegistration);
    } catch (error) {
      console.error(`Participant confirmation SMS failed for registration ${id}.`, error);
      confirmationFailures.push('SMS');
    }

    const message =
      confirmationFailures.length > 0
        ? `Thank you, ${registration.name}! Your registration has been saved and MAS notified, but we could not send your ${confirmationFailures.join(' and ')}. The free SMS service allows one text per day. Please check your details and contact masouthampton@gmail.com if needed.`
        : `Thank you, ${registration.name}! Your registration has been submitted to MAS. A confirmation SMS${registration.email ? ' and email' : ''} has been sent with the event time and location.`;
    res.status(201).json({ message });
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
      res.setHeader('Cache-Control', 'no-store');
      res.json({ cleared: deletedCount > 0, deletedCount });
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
