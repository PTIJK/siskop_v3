# Public landing and onboarding feature

All frontend code owned by the public signup flow lives here:

- `routes.tsx`: the single application-router integration point; keeps tenant-host root behavior and the legacy workspace login route.
- `pages/`: landing, package selection, registration, Firebase login, checkout, and registration recovery.
- `components/`: marketing shell, workspace entry, package features, and Spline hero.
- `assets/`: original hero artwork, imported through Vite.
- `api.ts`: public onboarding API client and display helpers.
- `firebase.ts`: Google/email authentication, short-lived identity exchange, and password reset.
- `styles.css`: feature styles scoped beneath `.marketing`.
- `metadata.ts`: page titles and metadata, restored when the feature unmounts.
- `workspace.ts` and `env.d.ts`: public/tenant host selection and Vite environment support.

The existing `App.tsx` registers `onboardingRoutes(<LoginPage />)` inside its routes and Suspense boundary. The existing login page is supplied as a dependency and does not import this feature. Existing UI primitives, authentication state, API error type, and shared API contracts are reused without editing their implementations.

Feature code calls Firebase for credentials and `/api/onboarding` for catalog, signup, login, payment, and recovery. The backend remains in `apps/backend/src/modules/onboarding`; database migrations, route registration, authentication session creation, dependencies, environment settings, and shared contracts are integration points outside this frontend folder. Moving frontend files does not eliminate those payment-to-dashboard dependencies.

Use the root `docs/landing-page/README.md` for Xendit and Spline configuration. Routine landing copy, layout, motion, registration UI, and checkout UI changes should stay in this feature folder.

Firebase staging setup and verified payment results are documented in
`infra/firebase/README.md` and `infra/firebase/VERIFICATION.md`. The staging build
uses `.env.staging` to enable returning access for the registration administrator
at `/login`; the existing tenant login component is exposed through `/login/legacy`.
After confirmed payment, checkout clears the onboarding session and redirects to
login. Only explicit Firebase authentication creates a dashboard session. New
accounts store a Firebase UID/provider and no local password hash. The existing
profile screen delegates credential management to Firebase for those accounts.

The registration form no longer asks for **Alamat workspace** or **Jenis koperasi**.
The onboarding backend creates a unique hostname label from the cooperative name
and a random suffix, and provisions the existing default KSP / Simpan pinjam unit.
The cooperative's postal address and operational principle remain registration fields.
After verified payment, the backend queues an Indonesian confirmation email with
the package, amount, registration reference, and public login link. Resend setup
and retry behavior are documented in `infra/firebase/RESEND.md`.
