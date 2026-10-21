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
import type { DatabaseSync as SqliteDatabase, SQLOutputValue } from 'node:sqlite';
import nodemailer, { type Transporter } from 'nodemailer';

const browserDistFolder = join(import.meta.dirname, '../browser');
const { DatabaseSync } = createRequire(import.meta.url)(
  'node:sqlite',
) as typeof import('node:sqlite');
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
  games: GameChoice[];
  emailSent: boolean;
};
type RegistrationInput = Omit<Registration, 'id' | 'createdAt' | 'games' | 'emailSent'> & {
  games: Game[];
};

const app = express();
const angularApp = new AngularNodeAppEngine();
app.use(express.json({ limit: '10kb' }));

let database: SqliteDatabase | undefined;

function getDatabase(): SqliteDatabase {
  if (database) {
    return database;
  }

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
    )
  `);
  chmodSync(databasePath, 0o600);
  return database;
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
  const { name, age, phone, email, guardian, games, consent } = value;
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

  return {
    valid: true,
    registration: {
      name: name.trim(),
      age,
      phone: phone.trim(),
      email: emailValue.trim(),
      guardian: age < 18 ? guardianName : '',
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
    '',
    'Selected games:',
    gameList,
    '',
    `Registration ID: ${registration.id}`,
    `Submitted: ${registration.createdAt}`,
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

function readRegistration(
  row: Record<string, SQLOutputValue>,
  key: Buffer,
): Registration {
  return decryptRegistration(
    String(row['registration_data']),
    key,
    Number(row['email_sent']) === 1,
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
    res.status(503).json({
      message:
        'Registration is not open yet. The committee email or secure storage service is not configured.',
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
    getDatabase()
      .prepare(
        `INSERT INTO registrations
          (id, created_at, registration_data)
         VALUES (?, ?, ?)`,
      )
      .run(
        id,
        createdAt,
        encryptRegistration(savedRegistration, encryptionKey),
      );

    try {
      await transporter.sendMail({
        from: process.env['SMTP_FROM'] || process.env['SMTP_USER'],
        to: 'masouthampton@gmail.com',
        subject: 'New MAS Board Games 2026 registration',
        text: buildRegistrationEmail(savedRegistration),
      });
      getDatabase()
        .prepare('UPDATE registrations SET email_sent = 1 WHERE id = ?')
        .run(id);
    } catch (error) {
      console.error(`Email notification failed for registration ${id}.`, error);
      res.status(502).json({
        message:
          'Your registration was saved, but MAS could not be notified by email. Please contact masouthampton@gmail.com and do not submit again.',
        registrationSaved: true,
      });
      return;
    }

    res.status(201).json({ message: `Thank you, ${registration.name}! Your registration has been submitted to MAS.` });
  } catch (error) {
    next(error);
  }
});

app.get('/api/admin/registrations', adminAuthentication, (_req, res, next) => {
  try {
    const encryptionKey = getEncryptionKey();
    if (!encryptionKey) {
      res.status(503).json({ message: 'The secure storage service is not configured.' });
      return;
    }
    const rows = getDatabase()
      .prepare(
        `SELECT registration_data, email_sent
         FROM registrations
         ORDER BY created_at DESC
         LIMIT 500`,
      )
      .all();
    res.setHeader('Cache-Control', 'no-store');
    res.json(rows.map((row) => readRegistration(row, encryptionKey)));
  } catch (error) {
    next(error);
  }
});

app.delete(
  '/api/admin/registrations/:id',
  adminAuthentication,
  (req, res, next) => {
    const registrationId = req.params['id'];
    if (
      typeof registrationId !== 'string' ||
      !/^[\da-f]{8}(?:-[\da-f]{4}){3}-[\da-f]{12}$/i.test(registrationId)
    ) {
      res.status(400).json({ message: 'Registration ID is invalid.' });
      return;
    }

    try {
      const result = getDatabase()
        .prepare('DELETE FROM registrations WHERE id = ?')
        .run(registrationId);
      if (result.changes === 0) {
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
      const database = getDatabase();
      const registrationId = req.params['id'];
      if (typeof registrationId !== 'string') {
        res.status(404).json({ message: 'Registration not found.' });
        return;
      }
      const row = database
        .prepare(
          `SELECT registration_data, email_sent
           FROM registrations WHERE id = ?`,
        )
        .get(registrationId);
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
      database
        .prepare('UPDATE registrations SET email_sent = 1 WHERE id = ?')
        .run(registration.id);
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
