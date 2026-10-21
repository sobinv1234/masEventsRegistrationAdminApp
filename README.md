# Mas

MAS Board Games 2026 registration app, with a committee-only dashboard.

## Registration and dashboard setup

The server requires Node.js 22.12 or later (Vercel is pinned to Node.js 22). Configure these environment variables on the server before accepting registrations:

| Variable | Purpose |
| --- | --- |
| `ADMIN_USERNAME` | Username for `/admin` |
| `ADMIN_PASSWORD` | Strong password for `/admin` |
| `SMTP_HOST` | SMTP server hostname |
| `SMTP_PORT` | SMTP server port (defaults to `587`) |
| `SMTP_SECURE` | Set to `true` when the SMTP server requires implicit TLS |
| `SMTP_USER` | SMTP account username |
| `SMTP_PASS` | SMTP account password or app password |
| `SMTP_FROM` | Optional sender address (defaults to `SMTP_USER`) |
| `REGISTRATION_ENCRYPTION_KEY` | Required 32-byte base64 key used to encrypt participant records |
| `DATABASE_URL` | Neon Postgres connection string; required on Vercel |
| `REGISTRATION_DB_PATH` | Optional local SQLite database path (defaults to `data/registrations.sqlite`) |

Generate the encryption key with `node -e "console.log(require('node:crypto').randomBytes(32).toString('base64'))"` and save it as a deployment secret. Back up this key separately and securely: losing it makes stored registrations unreadable.

Registration emails are sent to `masouthampton@gmail.com`. If SMTP is not configured, the API rejects registrations instead of claiming they were submitted. If a notification fails after a registration is saved, the form reports that state and the dashboard shows a retry action.

Participant details are encrypted before storage. Local development uses SQLite; when `DATABASE_URL` is set, the app uses Neon Postgres and creates its registrations table automatically. Back up the database and encryption key securely. The admin dashboard is available at `/admin`.

## Vercel deployment

`vercel.json` builds the Angular browser output and `api/[...path].ts` forwards `/api/*` requests to the existing Express API. Create a Neon Postgres database, add its connection string as `DATABASE_URL` in Vercel's project settings, configure the other environment variables above, then redeploy. The registrations table is created automatically on the first API request.

Vercel requests are rejected with a JSON configuration error if `DATABASE_URL` is missing; SQLite is never used as a Vercel fallback. Existing records in a local SQLite database are not copied automatically to Neon.

For local development, the SSR server reads secrets from an ignored `.env` file in the project root. Copy the generated admin credentials there as `ADMIN_USERNAME` and `ADMIN_PASSWORD`, and set `REGISTRATION_ENCRYPTION_KEY` to a 32-byte base64 key. To create a key:

```bash
node -e "console.log(require('node:crypto').randomBytes(32).toString('base64'))"
```

To run the SSR server after building, run:

```bash
npm run build
npm run serve:ssr:mas
```

The Angular development server (`ng serve`) previews the form but does not run the registration API. The `.env` file is loaded by `npm run serve:ssr:mas`, not by `ng serve` or your hosting provider. For the public dashboard, configure these values as secrets in your hosting provider and redeploy/restart the server.

This project was generated using [Angular CLI](https://github.com/angular/angular-cli) version 20.1.3.

## Development server

To start a local development server, run:

```bash
ng serve
```

Once the server is running, open your browser and navigate to `http://localhost:4200/`. The application will automatically reload whenever you modify any of the source files.

## Code scaffolding

Angular CLI includes powerful code scaffolding tools. To generate a new component, run:

```bash
ng generate component component-name
```

For a complete list of available schematics (such as `components`, `directives`, or `pipes`), run:

```bash
ng generate --help
```

## Building

To build the project run:

```bash
ng build
```

This will compile your project and store the build artifacts in the `dist/` directory. By default, the production build optimizes your application for performance and speed.

## Running unit tests

To execute unit tests with the [Karma](https://karma-runner.github.io) test runner, use the following command:

```bash
ng test
```

## Running end-to-end tests

For end-to-end (e2e) testing, run:

```bash
ng e2e
```

Angular CLI does not come with an end-to-end testing framework by default. You can choose one that suits your needs.

## Additional Resources

For more information on using the Angular CLI, including detailed command references, visit the [Angular CLI Overview and Command Reference](https://angular.dev/tools/cli) page.
