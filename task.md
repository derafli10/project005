# Project005 — Execution Backlog (task.md)

## ⚠️ Blocking Decisions (Resolve Before Sprint 1)
- [ ] Authentication Provider Decision — berdampak ke: S1-D2-T01 — fallback: Auth.js
- [x] Database Connection — berdampak ke: S1-D1-T04 — fallback: Neon Serverless Database
- [ ] Zod Version — berdampak ke: S1-D1-T01 — fallback: `zod@^3.25`
- [ ] WhatsApp/Telegram API keys — berdampak ke: S2-D10-T02 — fallback: Console logging stub
- [ ] Class Code format — berdampak ke: S2-D7-T02 — fallback: 6-char alphanumeric `nanoid`
- [ ] NGL-style feed moderation — berdampak ke: S2-D9-T03 — fallback: Server-side keyword filtering

## Architectural Guardrails Recap
- G1 — **Integer-Based Precision Mathematics**: Eliminasi error komputasi IEEE 754 dengan menggunakan integer untuk skor prioritas (basis points).
- G2 — **Strict Multi-Tenant Data Isolation**: Isolasi data ketat berbasis skema/baris untuk multi-tenant.
- G3 — **Strict Mobile-First Layout**: Desain sistem token atomic dengan pendekatan mobile-first layout (Tailwind CSS).
- G4 — **Production-Ready Code Standards**: Implementasi tanpa pemotongan (Zero-Truncation), validasi input (Zod), dan error boundary di semua level.

## Sprint 1 — Foundation & Core Features
**Sprint Goal:** Menyiapkan struktur dasar aplikasi, autentikasi, layout, pipeline dashboard utama dengan sistem prioritas, serta audit logging.
**Sprint Exit Criteria:**
- [ ] Skema database berhasil dimigrasi tanpa error.
- [ ] User bisa sign up, login, dan logout dengan benar (session JWT).
- [ ] Dashboard utama me-render data task terurut berdasarkan skor prioritas integer.
- [ ] Drag-to-reorder memunculkan prompt override dan persisten di audit log.

### Day 1 — Foundation (Dependencies, TS Config, DB Setup)
- [ ] **S1-D1-T01** — Install dependency utama project (zod, jose, bcryptjs, dll)
  - File: `package.json`
  - DoD: `npm install` berhasil dan package tercatat di package.json
  - Depends on: None
  - Est: 0.5h
  - Guardrail: G4

- [ ] **S1-D1-T02** — Perketat konfigurasi TypeScript
  - File: `tsconfig.json`
  - DoD: Setting strict, noUncheckedIndexedAccess aktif; `npx tsc --noEmit` berhasil
  - Depends on: None
  - Est: 0.5h
  - Guardrail: G4

- [ ] **S1-D1-T03** — Update konfigurasi Next.js untuk library kripto
  - File: `next.config.ts`
  - DoD: `serverExternalPackages: ['bcryptjs']` tertulis di file konfigurasi
  - Depends on: None
  - Est: 0.5h
  - Guardrail: G4

- [ ] **S1-D1-T04** — Buat skema Prisma lengkap (User, Auth, Domain Models)
  - File: `prisma/schema.prisma`
  - DoD: File schema.prisma lengkap dengan semua relasi dan index
  - Depends on: None
  - Est: 1.5h
  - Guardrail: G1, G2

- [ ] **S1-D1-T05** — Jalankan migrasi database awal
  - File: `prisma/schema.prisma`
  - DoD: `npx prisma migrate dev --name init` sukses membuat tabel di PostgreSQL
  - Depends on: S1-D1-T04
  - Est: 0.5h
  - Guardrail: G2

- [ ] **S1-D1-T06** — Buat singleton client Prisma untuk environment dev
  - File: `src/lib/db.ts`
  - DoD: File db.ts mem-parsing koneksi dengan benar dan bisa di-import
  - Depends on: S1-D1-T04
  - Est: 0.5h
  - Guardrail: G4

### Day 2 — Auth & Session Implementation
- [ ] **S1-D2-T01** — Konfigurasi Session Manager (Jose)
  - File: `src/lib/session.ts`
  - DoD: Fungsi encrypt, decrypt, createSession, updateSession, deleteSession tersedia
  - Depends on: None
  - Est: 1h
  - Guardrail: G2, G4

- [ ] **S1-D2-T02** — Tulis skema validasi (Zod) untuk Auth dan semua Model
  - File: `src/lib/definitions.ts`
  - DoD: File definisi memuat `SignupSchema`, `LoginSchema`, dll tanpa error TypeScript
  - Depends on: None
  - Est: 1h
  - Guardrail: G4

- [ ] **S1-D2-T03** — Buat Server Actions untuk Autentikasi (signup, login, logout)
  - File: `src/lib/auth.ts` / `src/app/actions/auth.ts`
  - DoD: Fungsi aksi mencakup validasi Zod, hashing dengan bcrypt, dan pemanggilan createSession
  - Depends on: S1-D2-T01, S1-D2-T02
  - Est: 1h
  - Guardrail: G4

- [ ] **S1-D2-T04** — Implementasi UI Login Form
  - File: `src/app/[lang]/(auth)/login/page.tsx`
  - DoD: Tampilan form login muncul, ada validasi state error, redirect sukses saat login
  - Depends on: S1-D2-T03
  - Est: 1h
  - Guardrail: G3

- [ ] **S1-D2-T05** — Implementasi UI Signup Form
  - File: `src/app/[lang]/(auth)/signup/page.tsx`
  - DoD: Form register berhasil membuat data User baru di database
  - Depends on: S1-D2-T03
  - Est: 1h
  - Guardrail: G3

### Day 3 — i18n & Core Layout
- [ ] **S1-D3-T01** — Setup file dictionaries untuk i18n
  - File: `src/lib/i18n/dictionaries.ts`, `src/lib/i18n/dictionaries/en.json`, `src/lib/i18n/dictionaries/id.json`
  - DoD: Fungsi `getDictionary` tersedia; file JSON memuat data terjemahan
  - Depends on: None
  - Est: 1h
  - Guardrail: G4

- [ ] **S1-D3-T02** — Implementasi Proxy untuk deteksi Locale
  - File: `src/app/proxy.ts`
  - DoD: Redirect otomatis ke `/en/` atau `/id/` bekerja jika diakses ke `/`
  - Depends on: None
  - Est: 1h
  - Guardrail: G4

- [ ] **S1-D3-T03** — Buat Root Layout dengan konfigurasi HTML lang
  - File: `src/app/[lang]/layout.tsx`
  - DoD: Layout memuat tag `<html lang="en|id">` dinamis berdasarkan param
  - Depends on: None
  - Est: 0.5h
  - Guardrail: G4

- [ ] **S1-D3-T04** — Update Globals CSS & UI Primitives awal
  - File: `src/app/globals.css`, `src/components/ui/button.tsx`, `src/components/ui/input.tsx`
  - DoD: CSS Custom Properties sesuai desain (G3) tersedia, komponen Button bisa dipakai
  - Depends on: None
  - Est: 1.5h
  - Guardrail: G3

- [ ] **S1-D3-T05** — Buat komponen struktur halaman (Sidebar, Header, Layout Authenticated)
  - File: `src/components/layout/sidebar.tsx`, `src/components/layout/header.tsx`, `src/app/[lang]/(dashboard)/layout.tsx`
  - DoD: User yang sudah login bisa melihat menu navigasi sidebar dan header
  - Depends on: S1-D3-T04
  - Est: 1.5h
  - Guardrail: G3

### Day 4 — Dashboard Pipeline
- [ ] **S1-D4-T01** — Buat kalkulator Priority Score (Integer-based)
  - File: `src/lib/priority-engine.ts`
  - DoD: Fungsi menghitung skor prioritas murni menggunakan integer (skala 0-10000) tanpa tipe float
  - Depends on: None
  - Est: 1h
  - Guardrail: G1

- [ ] **S1-D4-T02** — Buat Task Card component
  - File: `src/components/dashboard/task-card.tsx`
  - DoD: Kartu task menampilkan judul, skor prioritas (format % atau basis), dan deadline dengan rapi
  - Depends on: S1-D3-T04
  - Est: 1h
  - Guardrail: G3

- [ ] **S1-D4-T03** — Implementasi Dashboard Pipeline page
  - File: `src/app/[lang]/(dashboard)/page.tsx`
  - DoD: Halaman dashboard berhasil mengambil task user terurut berdasarkan skor prioritas
  - Depends on: S1-D4-T01, S1-D4-T02
  - Est: 1.5h
  - Guardrail: G2, G4

- [ ] **S1-D4-T04** — Pasang fitur drag-to-reorder (Framer Motion)
  - File: `src/components/dashboard/task-pipeline.tsx`
  - DoD: Task card bisa digeser ke atas/bawah secara halus dengan Reorder Group
  - Depends on: S1-D4-T03
  - Est: 1h
  - Guardrail: G3

### Day 5 — Override & Audit Logging (Day diperluas dari rencana asli karena scope integrasi UI & DB)
- [ ] **S1-D5-T01** — Implementasi Override Sheet Trigger
  - File: `src/components/ui/bottom-sheet.tsx`, `src/components/dashboard/override-sheet.tsx`
  - DoD: Bottom sheet muncul saat user selesai drag-reorder task
  - Depends on: S1-D4-T04
  - Est: 1h
  - Guardrail: G3

- [ ] **S1-D5-T02** — Buat Action untuk menyimpan Task Override
  - File: `src/app/actions/tasks.ts`
  - DoD: Alasan override dan perubahan posisi tersimpan di tabel TaskOverride
  - Depends on: S1-D5-T01
  - Est: 1h
  - Guardrail: G2

- [ ] **S1-D5-T03** — Buat mekanisme Task Edit Log otomatis
  - File: `src/app/actions/tasks.ts`
  - DoD: Tiap pemanggilan fungsi `updateTask` menghasilkan record di TaskEditLog untuk field yang berubah
  - Depends on: None
  - Est: 1.5h
  - Guardrail: G2

- [ ] **S1-D5-T04** — Buat halaman detail task dengan histori audit
  - File: `src/app/[lang]/(dashboard)/tasks/[id]/page.tsx`
  - DoD: UI menampilkan urutan perubahan (old value → new value) dengan jelas
  - Depends on: S1-D5-T03
  - Est: 1.5h
  - Guardrail: G3

## Sprint 2 — Analytics, Social, & Notifications
**Sprint Goal:** Menyelesaikan fitur advance seperti Cooked Meter, mekanik kelas/sosial, Anonymous Feed, dan integrasi Digest harian.
**Sprint Exit Criteria:**
- [ ] Cooked meter menampilkan status sesuai skor prioritas.
- [ ] Classroom flow berjalan dengan sistem invite code unik.
- [ ] Fitur export Instagram Story (Academic Wrapped) berhasil generate image.
- [ ] API endpoint cron untuk notifikasi harian siap dipanggil.

### Day 6 — Cooked Meter & Recovery Mode
- [ ] **S2-D6-T01** — Buat logic perhitungan tingkat Cooked Meter
  - File: `src/lib/cooked-meter.ts`
  - DoD: Fungsi menentukan tier (Main Character -> Overcooked) dari cumulative score yang berupa integer
  - Depends on: S1-D4-T01
  - Est: 0.5h
  - Guardrail: G1

- [ ] **S2-D6-T02** — Buat UI Widget Cooked Gauge
  - File: `src/components/cooked/cooked-gauge.tsx`
  - DoD: Widget berganti warna dan efek animasi sesuai tier yang didapat
  - Depends on: S2-D6-T01
  - Est: 1h
  - Guardrail: G3

- [ ] **S2-D6-T03** — Implementasi Sparkline Chart
  - File: `src/components/cooked/sparkline-chart.tsx`
  - DoD: Grafik tren 7 hari (Recharts) tampil dengan garis threshold yang tepat
  - Depends on: S2-D6-T01
  - Est: 1h
  - Guardrail: G3

- [ ] **S2-D6-T04** — Buat fitur Recovery Mode Panel
  - File: `src/components/cooked/recovery-mode.tsx`
  - DoD: Panel khusus muncul untuk memecah task besar saat tier 'Overcooked' dicapai
  - Depends on: S2-D6-T02
  - Est: 1.5h
  - Guardrail: G3

- [ ] **S2-D6-T05** — Hubungkan komponen ke Halaman Cooked Meter
  - File: `src/app/[lang]/(dashboard)/cooked/page.tsx`
  - DoD: Halaman menyajikan widget gauge dan sparkline secara terpadu
  - Depends on: S2-D6-T02, S2-D6-T03, S2-D6-T04
  - Est: 0.5h
  - Guardrail: G3

### Day 7 — Classroom Management & Crowdsourced Tasks
- [ ] **S2-D7-T01** — Tulis aksi pengelolaan Classroom
  - File: `src/app/actions/classroom.ts`
  - DoD: Fungsi Server Action CRUD Classroom terintegrasi dengan validasi Zod
  - Depends on: S1-D2-T02
  - Est: 1h
  - Guardrail: G4

- [ ] **S2-D7-T02** — Tulis UI pembuatan dan gabung kelas (Join by Code)
  - File: `src/app/[lang]/(dashboard)/classroom/page.tsx`
  - DoD: User bisa mendaftarkan kelas baru atau join lewat 6 digit class code nanoid
  - Depends on: S2-D7-T01
  - Est: 1.5h
  - Guardrail: G3

- [ ] **S2-D7-T03** — Tulis halaman daftar Task
  - File: `src/app/[lang]/(dashboard)/tasks/page.tsx`
  - DoD: Menampilkan semua task lintas classroom user lengkap dengan opsi filtering dasar
  - Depends on: None
  - Est: 1.5h
  - Guardrail: G3

### Day 8 — Viral Social Mechanics
- [ ] **S2-D8-T01** — Implementasi UI Academic Wrapped stat
  - File: `src/components/social/academic-wrapped.tsx`
  - DoD: Komponen menampilkan card 9:16 vertikal berisi rangkuman aktivitas user
  - Depends on: None
  - Est: 1.5h
  - Guardrail: G3

- [ ] **S2-D8-T02** — Implementasi fitur Download to Image (html2canvas)
  - File: `src/app/[lang]/(dashboard)/wrapped/page.tsx`
  - DoD: Tombol download berhasil men-generate PNG dari DOM komponen Wrapped
  - Depends on: S2-D8-T01
  - Est: 1h
  - Guardrail: G3

- [ ] **S2-D8-T03** — Buat animasi fullscreen GSAP untuk Academic Comeback
  - File: `src/components/social/academic-comeback.tsx`
  - DoD: Efek selebrasi penuh layar aktif saat event pemulihan task "Overcooked" dieksekusi
  - Depends on: S2-D6-T04
  - Est: 1.5h
  - Guardrail: G3

### Day 9 — Anonymous Classroom Feed
- [ ] **S2-D9-T01** — Buat form pengiriman pos anonim
  - File: `src/components/feed/anonymous-post-form.tsx`
  - DoD: Form berisi input text area dan pilihan kategori (tags)
  - Depends on: None
  - Est: 1h
  - Guardrail: G3

- [ ] **S2-D9-T02** — Buat kartu pos anonim
  - File: `src/components/feed/post-card.tsx`
  - DoD: Komponen Post Card bisa menerima props post dan menampilkannya tanpa identitas
  - Depends on: None
  - Est: 0.5h
  - Guardrail: G3

- [ ] **S2-D9-T03** — Buat Action & filter moderasi keyword sederhana
  - File: `src/app/actions/feed.ts`
  - DoD: Fungsi create post berhasil menolak post yang mengandung keyword dilarang (dummy test filter)
  - Depends on: S1-D2-T02
  - Est: 1.5h
  - Guardrail: G4

- [ ] **S2-D9-T04** — Integrasi UI feed anonim untuk kelas spesifik
  - File: `src/app/[lang]/(dashboard)/classroom/[code]/feed/page.tsx`
  - DoD: Feed anonim khusus classroom tertentu dirender sesuai akses keanggotan (Data Isolation)
  - Depends on: S2-D7-T02, S2-D9-T01, S2-D9-T02
  - Est: 1h
  - Guardrail: G2, G3

### Day 10 — Automated Daily Digest & Polish
- [ ] **S2-D10-T01** — Buat halaman pengaturan User Settings
  - File: `src/app/[lang]/(dashboard)/settings/page.tsx`
  - DoD: Input preferensi channel notifikasi, Contact ID, dan cron schedule pattern bisa disave
  - Depends on: None
  - Est: 1.5h
  - Guardrail: G3

- [ ] **S2-D10-T02** — Buat stub channel adapter dan engine digest
  - File: `src/lib/digest/engine.ts`, `src/lib/digest/channels.ts`
  - DoD: Fungsi engine mampu memformat teks update; channel adapter (WA/Telegram) mencetak payload ke console (stub fallback)
  - Depends on: None
  - Est: 1.5h
  - Guardrail: G4

- [ ] **S2-D10-T03** — Buat endpoint eksekusi Cron (API Route)
  - File: `src/app/api/cron/digest/route.ts`
  - DoD: Endpoint API bisa dipanggil (contoh dengan curl) dan mengembalikan respons HTTP success setelah mengecek db
  - Depends on: S2-D10-T02
  - Est: 1.5h
  - Guardrail: G4

- [ ] **S2-D10-T04** — QA Responsiveness, Integrasi Error Boundaries & Polishing
  - File: Semua layer komponen terkait
  - DoD: Aplikasi aman dari error 500 fatal dan tampak baik di mode mobile & tablet
  - Depends on: S1-D4-T03, S2-D6-T05, S2-D7-T03, S2-D10-T01
  - Est: 2h
  - Guardrail: G3, G4

## Final Verification Checklist (End of All Sprints)
### Automated Tests
- [ ] `npx prisma migrate dev --name init` // Verify schema compiles
- [ ] `npx tsc --noEmit` // Full type-check
- [ ] `npm run build` // Production build succeeds
- [ ] `npm run lint` // ESLint passes

### Manual Verification
- [ ] Navigate to `http://localhost:3000` → auto-redirects to `/en/` or `/id/`
- [ ] Sign up → creates user → redirects to dashboard
- [ ] Create classroom → generates class code → join with code from another account
- [ ] Create task → verify priority score computation (integer-based)
- [ ] Drag-reorder tasks → override sheet appears → reason persists in audit log
- [ ] View Cooked Meter → sparkline renders 7-day history → Recovery Mode triggers at tier 4
- [ ] Generate Academic Wrapped → 9:16 image downloads
- [ ] Post anonymously in feed → keyword filter blocks prohibited content
- [ ] All pages render correctly at 320px, 768px, 1024px, 1440px viewports
- [ ] Dark mode toggle works across all pages

### Property-Based Testing (future sprint)
- [ ] Priority score ∈ [0, 10000] for all valid inputs
- [ ] `∀ task: sksWeight ∈ [1,5] ∧ taskWeight ∈ [0,10000] → priorityScore ∈ [0,10000]`
- [ ] No floating-point values enter the priority pipeline
- [ ] TaskEditLog is append-only (no UPDATE/DELETE operations)
- [ ] ClassCode uniqueness across all ClassRoom records
