# Telegram notification untuk koperasi baru (Platform Admin)

## Context
Tim platform ingin tahu secara realtime saat ada koperasi baru masuk (halaman Platform Admin → Koperasi), tanpa harus refresh dashboard. Scope dipilih user:
- **Event:** (1) koperasi baru daftar via self-signup, (2) pembayaran registrasi lunas (koperasi jadi aktif).
- **Konfigurasi:** dari UI Platform Admin (bukan hanya env) — bot token, chat_id, on/off per event, tombol tes.

Mekanisme: Telegram Bot API `POST https://api.telegram.org/bot<token>/sendMessage` dikirim **setelah transaksi commit**, best-effort (timeout, tidak pernah menggagalkan registrasi/pembayaran) — sama seperti pola email invoice di `onboarding/service.ts` `register()` dan receipt di `lib/payments/confirm.ts`.

Setup sisi Telegram (didokumentasikan di halaman & doc): buat bot via @BotFather → dapat token → tambahkan bot ke grup tim → kirim pesan di grup → tombol "Deteksi chat" di UI memanggil `getUpdates` untuk menampilkan chat_id kandidat.

## Backend

### 1. Schema (`apps/backend/prisma/schema.prisma` + migration)
Single-row model, pola sama dengan `PricingSetting` (id = "singleton"). Platform-level, bukan tenant data → tanpa `tenantId`.
```prisma
model PlatformNotificationSetting {
  id                    String   @id @default("singleton")
  telegramEnabled       Boolean  @default(false)
  telegramBotTokenEnc   String?  // AES-256-GCM ciphertext; never returned by the API
  telegramChatId        String?
  notifyTenantRegistered Boolean @default(true)
  notifyRegistrationPaid Boolean @default(true)
  updatedAt             DateTime @updatedAt
  updatedById           String?
}
```
Token dienkripsi pakai key dari env `PLATFORM_SECRETS_KEY` (32 byte, base64) — node `crypto` `createCipheriv("aes-256-gcm")`. Helper kecil baru `apps/backend/src/lib/secret-box.ts` (`seal`/`open`). Tambah ke `.env.example`. Tanpa key → simpan ditolak dengan error jelas.

### 2. Types (`packages/types`)
`PlatformNotificationSettings` (response: `telegramEnabled`, `telegramChatId`, `hasBotToken`, `botTokenHint` = 4 char terakhir, flags event) dan `UpdatePlatformNotificationSettingsInput` (`botToken?` write-only; `null` = hapus).

### 3. Module baru `apps/backend/src/modules/platform-notifications/`
- `telegram.ts` — `sendTelegramMessage(token, chatId, html)` via `fetch` + `AbortSignal.timeout(8000)`, `parse_mode: "HTML"`, `disable_web_page_preview: true`; `getTelegramUpdates(token)` untuk deteksi chat. Escape pakai `escapeHtml` dari `onboarding/resend.ts`. Error dilempar sebagai kode (`TELEGRAM_HTTP_<status>`, `TELEGRAM_UNCONFIRMED`) — pola `sendResendEmail`.
- `service.ts`
  - `getSettings()` / `updateSettings(userId, input)` — token tidak pernah dikembalikan.
  - `sendTest()` dan `detectChats()` untuk UI.
  - `notifyPlatform(event)` — event union `{ type: "TENANT_REGISTERED", ... } | { type: "REGISTRATION_PAID", ... }`; baca setting (cache singkat in-memory, dibersihkan saat update), cek enabled + flag event, format pesan, kirim. **Tidak pernah throw** — error di-log (`console.warn` / logger yang dipakai modul lain) lalu ditelan.
  - `formatMessage(event)` — contoh:
    ```
    🆕 Koperasi baru mendaftar
    <b>Koperasi Universitas Muhammadiyah</b> (SYARIAH)
    Subdomain: koperasi-universitas-muhammadiyah-fbe31f
    Paket: Enterprise · Bulanan · Rp 1.500.000
    Status: Menunggu pembayaran
    Admin: Nama <email>
    ```
    Uang diformat dari string `Decimal` (`toFixed(2)`), tanpa `number`.
- `routes.ts` — mount di `platformRoutes()` (`modules/platform/routes.ts`) sebagai `router.use("/notifications", ...)`, sudah tertutup `requireAuth, requirePlatformAdmin`:
  - `GET /api/platform/notifications/settings`
  - `PUT /api/platform/notifications/settings`
  - `POST /api/platform/notifications/telegram/test`
  - `POST /api/platform/notifications/telegram/detect-chats`
  - Semua pakai envelope `ApiResponse<T>` + `ErrorCode`.
- `schema.ts` — zod untuk input (chatId string regex `^-?\d+$|^@\w+$`, token regex `^\d+:[\w-]{30,}$`).

### 4. Hook di titik event
- **Self-signup:** `modules/onboarding/service.ts` — `createRegistration()` sudah punya semua data (tenantName, slug, type, packageName, billingCycle, `priced.amountPerCycle`, `free`, adminName, identity.email). Kembalikan objek `platformEvent` di samping `invoiceEmail`; di `register()` panggil `notifyPlatform(platformEvent)` setelah commit, dibungkus `Promise.race` dengan timeout yang sama (`EMAIL_WAIT_MS`) supaya response pendaftaran tidak lambat.
- **Lunas:** `lib/payments/confirm.ts` — setelah `clearEntitlementCache(...)` dan jika `outcome.registration === true`, panggil `notifyPlatform({ type: "REGISTRATION_PAID", tenantName, invoiceNumber, total })`. Jalur `alreadyPaid` tidak mengirim (idempotent alami).
- Jalur `auth/service.ts registerTenant` (legacy, local-only) dan `platform/service.ts createTenant` (admin manual) **tidak** di-hook (sesuai scope).

## Frontend
- `apps/frontend/src/pages/platform/PlatformNotificationsPage.tsx` — form: toggle Telegram aktif, input bot token (password field, placeholder "Tersimpan •••• abcd" jika `hasBotToken`), chat_id + tombol "Deteksi chat" (list hasil `getUpdates`, klik untuk pilih), checkbox per event, tombol "Kirim tes", panduan singkat setup BotFather. Ikuti pola komponen di `PlatformAdminsPage.tsx` (PageHeader, form, toast).
- `apps/frontend/src/components/layout/nav.ts` — tambah `{ id: "p-notifications", label: "Notifikasi", href: "/platform/notifications", icon: Bell, group: "platform" }`.
- `apps/frontend/src/App.tsx` — route baru di grup platform.

## Tests (TDD — tulis dulu, gagal dulu)
- `platform-notifications/telegram.test.ts` — mock `fetch`: payload benar, non-2xx → `TELEGRAM_HTTP_*`, timeout → `TELEGRAM_UNCONFIRMED`.
- `platform-notifications/service.test.ts` — disabled/flag off → tidak kirim; token terenkripsi round-trip; GET tidak pernah memuat token; `notifyPlatform` tidak throw saat fetch gagal; escape HTML pada nama koperasi.
- `onboarding` test: registrasi tetap sukses saat Telegram error/lambat; event dipanggil sekali setelah commit (tidak saat transaksi rollback / P2002).
- `confirm` test: notify hanya saat `registration && !alreadyPaid`.
- routes test: non-platform-admin → 403.
- `lib/secret-box.test.ts` — round-trip, tamper → error.

## Milestones (implement + test tiap milestone sebelum lanjut)
PRD `telegram-notification-integration-prd.md` tidak ditemukan; user memilih lanjut dengan plan ini sebagai acuan. Reuse auth (`requireAuth`/`requirePlatformAdmin`), pola fetch+timeout `onboarding/resend.ts`, pola singleton `PricingSetting`, komponen UI halaman platform yang ada. Tanpa refactor di luar titik hook.
1. `secret-box` + schema/migration + types.
2. `telegram.ts` client.
3. Settings service + routes (GET/PUT/test/detect).
4. Hook onboarding `register()` + `confirm.ts`.
5. Frontend page + nav + route.
Akhir: laporkan konfigurasi eksternal yang masih dibutuhkan (BotFather token, bot di grup, `PLATFORM_SECRETS_KEY` di env lokal/staging/prod/Secret Manager, egress ke `api.telegram.org` dari Cloud Run/Contabo).

## Verification
1. `pnpm --filter @siskop/backend db:migrate`, set `PLATFORM_SECRETS_KEY` di `apps/backend/.env`.
2. `pnpm run test`, `pnpm run lint`, `pnpm run typecheck` — semua bersih, coverage ≥80%.
3. Manual: buat bot via @BotFather, masukkan ke grup, buka `/platform/notifications`, simpan token → "Deteksi chat" → pilih grup → "Kirim tes" → pesan masuk.
4. Daftar koperasi baru lewat alur onboarding (paket berbayar) → pesan "Koperasi baru mendaftar" masuk; tandai invoice lunas di Faktur → pesan "Pembayaran registrasi lunas" masuk.
5. Matikan internet / token salah → registrasi tetap sukses, warning di log.
6. Commit conventional: `feat(platform): telegram notifications for new koperasi registrations`.
