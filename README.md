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
| `CRON_SECRET` | Required on Vercel; secret bearer token for scheduled registration clearing |
| `REGISTRATION_DB_PATH` | Optional local SQLite database path (defaults to `data/registrations.sqlite`) |

Generate the encryption key with `node -e "console.log(require('node:crypto').randomBytes(32).toString('base64'))"` and save it as a deployment secret. Back up this key separately and securely: losing it makes stored registrations unreadable.

Registration notifications are emailed to `masouthampton@gmail.com`. Participants receive a confirmation email with the event time and location when they provide an email address. SMS notifications are not sent. If a participant confirmation email fails after registration is saved, the form reports the failure. If the committee notification email fails, the form reports that the registration was saved and the dashboard shows a retry action.

The registration form requires a membership number; participants must use it as the bank transfer reference. A matching member name is looked up when the number is entered; when multiple names share a number, participants choose the correct name from a dropdown. A single matching name is autofilled and can be edited. Entering a roster mobile number also looks up the member and fills the membership number and name. UK mobile numbers are matched consistently whether entered with a leading `0`, the `+44` country code, or without a country prefix. The lookup directory is generated from the April 2026 membership roster in `src/membership-directory.ts`; update it when the roster changes. The number is included in the admin dashboard and registration download.

Participant details are encrypted before storage. Local development uses SQLite; when `DATABASE_URL` is set, the app uses Neon Postgres and creates its registrations table automatically. Back up the database and encryption key securely. The admin dashboard is available at `/admin`.

## Vercel deployment

`vercel.json` builds the Angular browser output. The native ES module handlers in `api/` forward registration, admin, and cleanup requests to the Express API; admin routes have explicit Vercel function entries. Create a Neon Postgres database, add its connection string as `DATABASE_URL` in Vercel's project settings, configure `SMTP_HOST`, `SMTP_USER`, `SMTP_PASS`, `REGISTRATION_ENCRYPTION_KEY`, and a strong random `CRON_SECRET`, then redeploy. Add the variables to every environment you test: deployment-specific preview URLs use **Preview** variables, while the production domain uses **Production** variables. The registrations and clear-schedule tables are created automatically on the first API request.

The dashboard's **Clear all data** action opens a confirmation dialog and schedules a purge 10 days later. The schedule can be cancelled before it runs. The daily Vercel Cron runs at 03:00 UTC, so the purge may occur up to 24 hours after its scheduled time. It deletes registrations that existed when the clear was scheduled and keeps later submissions. Vercel Cron jobs run on production deployments; test the dashboard schedule using Production environment variables and a production deployment.

Generate `CRON_SECRET` locally with `node -e "console.log(require('node:crypto').randomBytes(32).toString('base64url'))"` and add the output as a Vercel environment variable. Do not commit or share the generated secret.

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
