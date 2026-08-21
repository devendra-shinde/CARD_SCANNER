# CardVault — Master Technical & Operations Architecture

**Product**: Business-Card OCR + Smart Contact & Campaign Management
**Platforms**: Android-first, iOS-compatible, PWA/web fallback
**Doc version**: 1.0 · June 2026
**Audience**: Founders, tech leads, DevOps, future engineering hires

> This document was produced by inspecting the actual codebase in `/app` (backend + frontend + memory). Every "Currently Implemented" line is grounded in a specific file. "Partially Implemented" = code exists but is gated on missing keys/config. "Recommended for Production" = not in the repo — must be added before scale.

---

## 0. TL;DR — the 60-second overview

| Layer | What ships today | Prod-ready? |
|---|---|---|
| Mobile app | Expo SDK 54 / RN 0.81 / React 19 / expo-router / TypeScript | ✅ Yes, single dev build |
| Frontend delivery | Metro dev server on port 3000 (preview) + web export | ⚠️ Preview only — needs EAS/Play/App Store build |
| Backend | FastAPI (Python 3.11) on port 8001, 10 APIRouters | ✅ Modular, ~55-line entry |
| DB | MongoDB (local via `MONGO_URL`) | ⚠️ Single-node, no indexes/backups |
| OCR | Claude Haiku 4.5 vision (primary) → Tesseract fallback | ✅ Working via Emergent LLM key |
| AI | Claude Haiku (OCR + Email assistant + enrichment text parse) | ✅ Working |
| Auth | Email + password + 6-digit OTP + Emergent-managed Google | ✅ Working |
| Email delivery | User-provided SMTP (Gmail/Yahoo/custom) — no system queue | ⚠️ Synchronous, no retry |
| WhatsApp | `wa.me` deep-link generation (Pro tier) | ✅ No BSP needed |
| Payments | Razorpay stubs (503 until keys set) | 🟡 Partially implemented |
| Excel I/O | openpyxl-based, base64 in JSON | ✅ Working |
| Image storage | base64 fields in Mongo (avatar, attachments) | 🟡 Works, doesn't scale |
| Push, background jobs, Redis, queues, CDN | — | 🔴 Not implemented |

Deployment status today: **Emergent preview environment only**. No production domain, no CI/CD pipeline, no monitoring, no Play Store / App Store listing.

---

## 1. System architecture at a glance

### 1.1 High-level diagram

```
┌────────────────────── MOBILE / WEB CLIENT ──────────────────────┐
│                                                                  │
│  Expo React Native (iOS · Android · Web)                         │
│  ├─ expo-router (file-based)                                     │
│  ├─ AuthProvider (JWT in SecureStore / localStorage)             │
│  ├─ I18nProvider (11 bundled languages)                          │
│  ├─ Camera + ImagePicker (base64 image capture)                  │
│  └─ WebBrowser (Emergent Google OAuth + Razorpay checkout URL)   │
│                                                                  │
└─────────────────────────────┬───────────────────────────────────┘
                              │ HTTPS
                              │ Bearer <JWT> (HS256, 24h)
                              │ EXPO_PUBLIC_BACKEND_URL + /api
                              ▼
┌──────────────────── EMERGENT INGRESS / K8s ─────────────────────┐
│  path `/`     → port 3000 (Expo Metro dev)                       │
│  path `/api/*` → port 8001 (FastAPI, uvicorn)                    │
└─────────────────────────────┬───────────────────────────────────┘
                              ▼
┌───────────────────── FASTAPI BACKEND (server.py) ───────────────┐
│  APIRouter(prefix="/api") mounts:                                │
│  • auth   • contacts   • ai (ocr + email + enrich)               │
│  • email_settings   • templates   • campaigns   • analytics       │
│  • billing   • excel   • whatsapp                                │
│                                                                  │
│  Shared modules:                                                  │
│  • deps.py     Motor client, helpers (now, iso, clean_doc,        │
│               normalize_tags, render_vars), constants             │
│  • schemas.py  All Pydantic v2 request/response models            │
│  • auth_utils.py  bcrypt + JWT + OTP + HTTPBearer                 │
│  • ocr_utils.py   Claude Vision → Tesseract fallback              │
│  • email_utils.py SMTP send + system-OTP send                     │
│  • enrich_utils.py httpx + BeautifulSoup scraping                 │
│  • excel_utils.py openpyxl workbook build/parse                   │
│  • plans.py       Free/Basic/Pro feature + quota rules            │
└──────┬──────────────────────────────┬────────────────────┬──────┘
       │                              │                    │
       │ AsyncIOMotorClient           │ httpx/emergentint. │ smtplib
       ▼                              ▼                    ▼
┌──────────────┐    ┌──────────────────────────────┐   ┌──────────────┐
│  MongoDB     │    │  External APIs               │   │  User SMTP    │
│  cardvault_db│    │  • Emergent LLM (Claude)     │   │  Gmail /      │
│  collections:│    │  • Emergent Google Auth      │   │  Yahoo /      │
│  users       │    │  • Emergent session verify   │   │  custom       │
│  contacts    │    │  • Razorpay (stubbed)        │   │  (per-user)   │
│  otps        │    │  • Any website (enrich)      │   └──────────────┘
│  campaigns   │    └──────────────────────────────┘
│  campaign_history│
│  templates       │
│  wa_templates    │
│  email_configs   │
│  email_accounts  │
│  billing_orders  │
└──────────────────┘
```

### 1.2 Process/container topology (today)

Everything runs inside **one Kubernetes pod** managed by supervisord:
- `backend` — uvicorn on 0.0.0.0:8001 (auto-reload watching `/app/backend`)
- `expo` — `expo start` on port 3000 (Metro dev)
- `mongodb` — bundled locally in the same container, `mongod` on 27017

There is currently **no separation** between dev, preview, staging, and prod. See §26.

---

## 2. Frontend architecture (mobile app)

### 2.1 Stack — currently implemented

| Concern | Library | Version | Why |
|---|---|---|---|
| Runtime | expo | 54.0.35 | Managed workflow, works on iOS/Android/Web |
| UI | react-native | 0.81.5 | Cross-platform native |
| Router | expo-router | 6.0.24 | File-based, typed routes enabled |
| Bottom sheets | @gorhom/bottom-sheet | 5.2.14 | AI email assistant, filter chips |
| Gestures | react-native-gesture-handler | 2.28.0 | Required by bottom-sheet |
| Animations | react-native-reanimated | 4.1.1 | Smooth transitions |
| Safe area | react-native-safe-area-context | 5.6.0 | Notch handling |
| Icons | @expo/vector-icons | 15.1.1 | Ionicons/Feather |
| Camera | expo-camera | ~17.0.10 | Business-card scan |
| Image picker | expo-image-picker | ~17.0.11 | Gallery import |
| Image manip | expo-image-manipulator | ~14.0.8 | Downscale before OCR |
| Fast image | expo-image | 3.0.11 | Cached remote loads |
| Files | expo-file-system + expo-document-picker + expo-sharing | — | Excel import/export/share |
| Storage | expo-secure-store + @react-native-async-storage/async-storage | — | JWT in SecureStore; user profile in AsyncStorage |
| Web auth | expo-web-browser | ~15.0.11 | Emergent Google OAuth + Razorpay |
| WebView | react-native-webview | 13.15.0 | Reserved for Razorpay checkout modal |
| SVG | react-native-svg | 15.12.1 | Analytics charts, custom icons |
| Language | Custom I18nProvider (see §11) | — | 11 bundled string files |

### 2.2 Folder layout — currently implemented

```
frontend/
├─ app.json                    # Expo config (permissions, bundle IDs)
├─ package.json                # Yarn 1.22, packageManager pinned
├─ app/                        # expo-router root
│  ├─ _layout.tsx              # Providers (Auth, I18n, GestureHandler, SafeArea) + RouterGate
│  ├─ +html.tsx                # Web HTML shell
│  ├─ index.tsx                # Splash / language onboarding
│  ├─ (auth)/                  # Group: welcome, login, signup, verify-otp, forgot-password
│  ├─ (tabs)/                  # Group: index, contacts, scan-placeholder, campaigns, settings
│  ├─ contact/                 # [id].tsx, edit.tsx, new.tsx
│  ├─ campaign/                # [id].tsx, new.tsx (3-step wizard)
│  ├─ settings/                # email, templates, duplicates, language, about
│  ├─ analytics.tsx
│  ├─ billing-history.tsx
│  ├─ data.tsx                 # Import/export screen
│  ├─ plans.tsx
│  ├─ scan.tsx, scan-review.tsx
│  └─ whatsapp.tsx
├─ src/
│  ├─ components/
│  │  ├─ google-auth-button.tsx
│  │  └─ ui.tsx                # Design-system primitives
│  ├─ context/auth.tsx         # AuthProvider + consumePendingWebSession pre-refresh
│  ├─ hooks/use-icon-fonts.ts
│  ├─ i18n/                    # 11 x strings.<lang>.ts + index.tsx
│  ├─ lib/
│  │  ├─ api.ts                # Bearer-injecting fetch wrapper (30s timeout)
│  │  └─ google-auth.ts        # Web + mobile Emergent OAuth
│  ├─ theme/                   # colors, spacing, radius, typography
│  └─ utils/storage/           # Platform-split: SecureStore vs localStorage
└─ assets/                     # icons, splash, logos
```

### 2.3 Auth state machine (frontend)

`AuthProvider` (`src/context/auth.tsx`):
1. Mount → read cached user from AsyncStorage (`cardvault_user`).
2. **`await consumePendingWebSession()`** — parses `?session_id=` or `#session_id=` from the URL (web-only), POSTs `/auth/google-session`, writes JWT to SecureStore. Runs **before** `refresh()` to avoid the race that was recently fixed (401 wipe of just-written token).
3. `await refresh()` — GET `/auth/me`; on failure clears token + user.
4. Set `loading=false`.

Actions: `signup`, `verifyOtp`, `resendOtp`, `login`, `forgotPassword`, `resetPassword`, `logout`.

**RouterGate** in `app/_layout.tsx` decides which stack to show based on `user + onboarded + loading`.

### 2.4 Storage abstraction

`src/utils/storage/` is platform-split:
- `index.ts` (native): SecureStore for secrets, AsyncStorage for JSON.
- `index.web.ts`: localStorage for both.
- Same API surface: `getItem`, `setItem`, `removeItem`, `secureGet`, `secureSet`, `secureRemove`.

### 2.5 Where the app calls the backend

`src/lib/api.ts` — single `fetch` wrapper:
- Reads `EXPO_PUBLIC_BACKEND_URL` (currently `https://ocr-contacts-hub-1.preview.emergentagent.com`).
- Injects `Authorization: Bearer <JWT>` on `auth: true` calls.
- 30-second timeout via `AbortController`.
- Throws typed `ApiError(status, data)`.

---

## 3. Backend architecture (FastAPI)

### 3.1 Post-refactor layout — currently implemented

```
backend/
├─ server.py            # 55 lines: mounts routers + CORS
├─ deps.py              # Motor client, logger, helpers, RESERVED_VARS, EMERGENT_SESSION_URL
├─ schemas.py           # All Pydantic v2 models (auth, contacts, campaigns, etc.)
├─ auth_utils.py        # bcrypt(rounds=12), JWT HS256, OTP, HTTPBearer dep
├─ ocr_utils.py         # Claude Vision → Tesseract fallback + face-crop avatar
├─ email_utils.py       # SMTP send + system-OTP send + OTP HTML template
├─ enrich_utils.py      # httpx + BeautifulSoup site scrape + industry hint
├─ excel_utils.py       # openpyxl build/parse (16 columns, README sheet)
├─ plans.py             # Free / Basic ₹100·₹1000 / Pro ₹200·₹2000 + quotas
├─ requirements.txt
├─ routes/
│  ├─ auth.py           # signup, verify-otp, login, resend-otp,
│  │                    # forgot/reset password, /me, /google-session, /
│  ├─ contacts.py       # CRUD + facets + duplicates + recipient-status + merge
│  ├─ ai.py             # /ocr/scan, /ai/write-email, /enrich
│  ├─ email_settings.py # /settings/email + /settings/emails (multi-account)
│  ├─ templates.py      # Email template CRUD
│  ├─ campaigns.py      # Create + send + list + get; per-recipient variable render
│  ├─ analytics.py      # Dashboard aggregations
│  ├─ billing.py        # status/checkout/verify/cancel/history (Razorpay)
│  ├─ excel.py          # Import preview + commit (O(N+M) indexed dedupe) + export
│  └─ whatsapp.py       # wa.me link gen + templates
└─ tests/               # pytest suite (used by testing_agent)
```

### 3.2 Runtime & process model

- Python 3.11 · FastAPI 0.110 · uvicorn 0.25 · Motor 3.3
- Single process, auto-reload watching `/app/backend`.
- No workers, no async task queue, no background scheduler.
- CORS: `allow_origins=["*"]` — **must be locked down in prod**.
- All routes under `/api`. Ingress terminates TLS and forwards `/api/*` → port 8001.

### 3.3 Complete API surface (all under `/api`)

| Module | Endpoints |
|---|---|
| root | `GET /` |
| auth | `POST /auth/signup`, `POST /auth/verify-otp`, `POST /auth/login`, `POST /auth/resend-otp`, `POST /auth/forgot-password`, `POST /auth/reset-password`, `GET /auth/me`, `POST /auth/google-session` |
| contacts | `POST /contacts`, `GET /contacts`, `GET /contacts/facets`, `GET /contacts/duplicates`, `GET /contacts/recipient-status`, `GET /contacts/{id}`, `PUT /contacts/{id}`, `DELETE /contacts/{id}`, `POST /contacts/merge` |
| ai/ocr | `POST /ocr/scan`, `POST /ai/write-email`, `POST /enrich` |
| settings | `GET/POST /settings/email`, `POST /settings/email/test`, `GET/POST /settings/emails`, `DELETE /settings/emails/{id}`, `POST /settings/emails/{id}/default`, `POST /settings/emails/{id}/test` |
| templates | `GET/POST /templates`, `DELETE /templates/{id}` |
| campaigns | `GET/POST /campaigns`, `GET /campaigns/{id}`, `POST /campaigns/{id}/send` |
| analytics | `GET /analytics` |
| billing | `GET /billing/status`, `POST /billing/checkout`, `POST /billing/verify`, `POST /billing/cancel`, `GET /billing/history` |
| excel | `GET /contacts/import/template`, `POST /contacts/import/preview`, `POST /contacts/import/commit`, `POST /contacts/export` |
| whatsapp | `GET/POST /whatsapp/templates`, `DELETE /whatsapp/templates/{id}`, `POST /whatsapp/generate-links` |

### 3.4 Recommended for production

- 🔴 Replace `allow_origins=["*"]` with an explicit allowlist (mobile bundle IDs + web domain).
- 🔴 Add gunicorn + multiple uvicorn workers (`gunicorn -k uvicorn.workers.UvicornWorker -w 4 server:app`).
- 🔴 Add a `/healthz` and `/readyz` endpoint for the load balancer.
- 🔴 Rate-limit signup/login/OTP endpoints (see §22).
- 🟠 Add request/response logging middleware with correlation IDs.

---

## 4. Data layer — MongoDB

### 4.1 What is deployed today
- **Engine**: MongoDB (community). Connection string `mongodb://localhost:27017` — running inside the same container.
- **Database**: `cardvault_db`.
- **Driver**: Motor 3.3.1 (async pymongo).
- **Backups**: ❌ None.
- **Indexes**: ❌ **None created programmatically** (verified via grep). All queries scan or use natural `_id` index.
- **Replication / sharding**: ❌ Single node.
- **TLS in transit**: ❌ Local socket only.
- **Encryption at rest**: ❌ Not configured.

### 4.2 Collections & shapes (as written by the code)

Because Mongo is schemaless, "schemas" below reflect what the writers actually store.

**`users`**
```
{
  id: uuid4 (str),               // logical primary key — every query uses this
  name, email (lower),           // email is the login identity
  password: bcrypt-hash,         // "" for Google-only users
  organization, role,
  email_verified: bool,
  provider: "google" | undefined,
  avatar_url: str,               // set only for Google users
  plan: "free" | "basic" | "pro",
  subscription_cycle: "monthly" | "yearly",
  subscription_id: str,          // razorpay_payment_id
  subscription_current_period_end: Date,
  created_at, updated_at: Date
}
```

**`contacts`** — the largest collection
```
{
  id: uuid4, user_id: uuid4,     // multi-tenant fence
  name, designation, company,
  email, phone, website,
  address, city, state, country, pincode,
  industry,
  tags: [str, ...],              // normalised lowercase
  notes, linkedin, company_size,
  social_links: { linkedin, twitter, facebook, instagram, youtube },
  favorite: bool,
  source: "manual" | "ocr" | "import",
  image_b64?: str,               // ⚠️ raw scanned card — see §7.3
  avatar_b64?: str,              // ⚠️ face-crop from OCR
  created_at, updated_at: Date
}
```

**`otps`**
```
{ email, otp: "123456", purpose: "signup" | "reset", expires_at, created_at }
```

**`campaigns`**
```
{
  id, user_id,
  name, subject, body_html,
  recipient_ids: [uuid, ...],  recipient_emails: [str, ...],  recipient_count: int,
  email_account_id?: uuid,
  attachments: [{ filename, mime_type, content_b64 }],  // ⚠️ base64 in Mongo
  status: "draft" | "sent",
  sent_count, failed_count, skipped_quota_count, skipped_ratelimit_count,
  opened_count, clicked_count,   // reserved — never incremented today
  created_at, updated_at, sent_at
}
```

**`campaign_history`** — one doc per attempted send (used for quota checks)
```
{ id, user_id, campaign_id, recipient_email, status: "sent"|"failed", error?, sent_at }
```

**`templates`** — user's own email templates
```
{ id, user_id, name, subject, body_html, created_at, updated_at }
```

**`wa_templates`** — same shape as templates but for WhatsApp bodies (`body` field instead of `body_html`).

**`email_configs`** — legacy single SMTP per user (kept for compat)
```
{ user_id, provider, smtp_host, smtp_port, smtp_user, smtp_pass, from_name, reply_to, use_tls, updated_at }
```

**`email_accounts`** — multi-account SMTP
```
{ id, user_id, label, provider, smtp_host, smtp_port, smtp_user, smtp_pass,
  from_name, reply_to, use_tls, is_default, created_at, updated_at }
```

**`billing_orders`**
```
{ id, user_id, order_id (razorpay), plan, cycle, amount (paise),
  status: "created"|"paid", payment_id?, created_at, paid_at? }
```

### 4.3 Relationships (logical — Mongo has no FK)

```
users.id ─┬─◄ contacts.user_id
          ├─◄ campaigns.user_id  ──── recipient_ids ⇒ contacts.id (soft ref)
          ├─◄ campaign_history.user_id ── campaign_id
          ├─◄ email_configs / email_accounts.user_id
          ├─◄ templates / wa_templates.user_id
          └─◄ billing_orders.user_id
```

### 4.4 Recommended for production — Mongo hardening

- 🔴 **Move off single-node localhost.** Use MongoDB Atlas M10+ (or self-hosted 3-node replica set). Cost estimate: Atlas M10 ≈ $57/mo, M0 free for < 512MB (fine for pilot).
- 🔴 **Create these indexes** on startup (add to `deps.py` `_startup`):
  ```python
  await db.users.create_index("email", unique=True)
  await db.users.create_index("id", unique=True)
  await db.contacts.create_index([("user_id", 1), ("created_at", -1)])
  await db.contacts.create_index([("user_id", 1), ("email", 1)])
  await db.contacts.create_index([("user_id", 1), ("phone", 1)])
  await db.contacts.create_index([("user_id", 1), ("tags", 1)])
  await db.contacts.create_index([("user_id", 1), ("industry", 1)])
  await db.contacts.create_index([("user_id", 1), ("country", 1), ("state", 1), ("city", 1)])
  await db.otps.create_index("expires_at", expireAfterSeconds=0)  # TTL cleanup
  await db.otps.create_index([("email", 1), ("purpose", 1)])
  await db.campaign_history.create_index([("user_id", 1), ("recipient_email", 1), ("sent_at", -1)])
  await db.campaign_history.create_index([("user_id", 1), ("sent_at", -1)])
  await db.campaigns.create_index([("user_id", 1), ("created_at", -1)])
  await db.billing_orders.create_index("order_id", unique=True)
  ```
- 🔴 **Backups**: Atlas provides continuous backup + PITR out of the box. Self-hosted → nightly `mongodump` to S3 with 30-day retention.
- 🔴 **TLS**: use `mongodb+srv://` with the Atlas cert bundle.
- 🔴 **Encryption at rest**: enabled by default on Atlas; on self-host, LUKS on the data volume.
- 🟠 **Field-level encryption** for `smtp_pass`, `avatar_b64`, `image_b64`, `content_b64` — use Mongo CSFLE or app-side AES-GCM with a KMS-managed key. **Today `smtp_pass` is stored in plaintext.**

---

## 5. OCR architecture

### 5.1 Where OCR runs
**Server-side, not on-device.** The mobile app captures/picks an image, base64-encodes it, and POSTs to `/api/ocr/scan`. The device does **not** run ML Kit.

### 5.2 Engine strategy (from `ocr_utils.py`)
1. **Primary — Claude Haiku 4.5 vision** via `emergentintegrations.llm.chat` (`with_model("anthropic","claude-haiku-4-5-20251001")`). Prompt returns strict JSON with 16 fields including `raw_text`, `name`, `email`, `phone`, `all_emails[]`, etc. Confidence marked `high` if any of name/email/phone parsed.
2. **Fallback — pytesseract + regex + Claude text parse**. Kicks in when the vision call errors. Uses:
   - PIL preprocessing: max side 1800 px, grayscale, autocontrast.
   - Regex extraction of emails / phones (7–15 digits) / websites / PIN codes.
   - Claude text-only call to fill name/designation/company/address/city/state/country/industry from the raw text + regex hits.
3. **Face crop for avatar** — OpenCV Haar cascade (`haarcascade_frontalface_default.xml`) finds the largest face, expands 60%, JPEG-encodes at Q85 → returned as `avatar_b64` and stored on the contact.

### 5.3 Data flow — "user scans a card"
```
mobile ─ camera/gallery
      ─ expo-image-manipulator (resize)
      ─ base64 (raw string)
      ─ POST /api/ocr/scan  { image_b64 }
FastAPI ─ ocr_utils.scan_business_card()
      ├─ _decode_image + _extract_avatar_b64 (opencv)
      ├─ _vision_extract → emergentintegrations → Claude API
      │   └─ on failure → _tesseract_extract → pytesseract → Claude text
      └─ returns { name, email, phone, ..., avatar_b64, engine, confidence }
mobile ─ scan-review.tsx (user edits) → POST /contacts (source:"ocr", image_b64 stored)
```

### 5.4 Cost & latency (measured/estimated)
- Vision call: ~1.5–3s per card, ~500–1500 tokens = ~$0.001–$0.003 per scan on Claude Haiku 4.5 pricing.
- Tesseract fallback: ~800 ms on the pod's CPU; only invoked on API failure.
- Emergent LLM key is billed to the Emergent universal balance.

### 5.5 Image storage today
- `image_b64` + `avatar_b64` stored **inside the contact document** in Mongo. A single scanned card can add ~200–500 KB per record.
- 🟠 **Partially implemented, does not scale.** See §7.

### 5.6 Recommended for production
- 🟠 Offload the raw card image to object storage (S3/R2/Emergent Object Storage) and store only the URL on the contact.
- 🟢 Optionally add on-device Google ML Kit (native module) for a faster preview & offline fallback — but keep server-side Claude for accuracy/parsing.
- 🟢 Cache OCR results by SHA-256(image) so re-scans are free.

---

## 6. AI enrichment architecture

### 6.1 Currently implemented
`POST /api/enrich` (`enrich_utils.scrape_website`):
- Normalises URL (adds `https://` if missing).
- `httpx` fetch with a real UA header, 8 s timeout, follow redirects.
- BeautifulSoup (lxml) parses:
  - `<title>`, `<meta name="description">`, `og:description`, `og:site_name`, `og:title`.
  - All `<a href>` → detects LinkedIn, Twitter/X, Facebook, Instagram, YouTube.
- Naive industry keyword classifier (10 buckets: Software, Marketing, Finance, Healthcare, Education, Retail, Consulting, Manufacturing, Legal, Real Estate).
- Returns `{ website, title, description, site_name, socials, industry_guess }`.

### 6.2 AI email assistant (`/ai/write-email`)
- 6 actions: `generate | rewrite | shorten | expand | formalize | friendly`.
- Claude Haiku 4.5 via `emergentintegrations`; strict JSON output `{subject, body}`.
- 402 returned if `EMERGENT_LLM_KEY` missing.

### 6.3 Data flow
```
mobile → POST /enrich {website|company}
      → enrich_utils.scrape_website (no LLM here)
      → contact detail screen shows description/socials/industry
      → user can Save → contact.notes / company_size / socials updated
```

### 6.4 Recommended for production
- 🟢 Cache scrape results by `sha256(url)` for 7 days.
- 🟢 Add async background enrichment (post-scan) via a worker (§17) so scan doesn't block on scraping.
- 🟢 Consider a paid enrichment provider (Clearbit / Apollo) — better company/industry data, higher $/lookup.

---

## 7. File / image storage architecture

### 7.1 Currently implemented
Everything is **base64 inside Mongo documents**:
- `contacts.image_b64` — raw scanned card (optional).
- `contacts.avatar_b64` — face crop from OCR.
- `campaigns.attachments[].content_b64` — MIME-encoded and stapled to email at send time by `email_utils._build_message`.

Excel workbooks are **not stored** — they are built in-memory (io.BytesIO), returned as base64 to the client, and downloaded locally.

### 7.2 Why it works today
- MVP scale: single-digit MB per user.
- No infra dependencies to onboard.

### 7.3 Why it breaks at scale
- Mongo 16 MB document cap. Two full-size card scans + a 4 MB PDF attachment can exceed it.
- Every contact list query pulls the full document unless `projection` is added.
- Backups grow non-linearly.
- No CDN — every avatar load re-hits the API.

### 7.4 Recommended for production
- 🔴 **Adopt Emergent Managed Object Storage** (S3-compatible) for `image_b64`, `avatar_b64`, `attachments`. Store only a signed URL + metadata on the document.
- 🔴 Serve avatars through a CDN with cache-control.
- 🟠 Use `Presigned URL upload` from the mobile app so the FastAPI process is not the byte pipeline.

---

## 8. Authentication & user management

### 8.1 Currently implemented (auth_utils.py + routes/auth.py + Emergent Google)
- **Email + password**
  - bcrypt (rounds=12) hashing.
  - 6-digit numeric OTP, 10-minute expiry, stored in `otps` collection.
  - If `SYSTEM_SMTP_*` env not set → OTP is returned in the JSON response (`dev_otp`) and shown in a "Preview Mode" banner on the OTP screen. **Must be disabled in prod.**
- **Google Sign-In** — Emergent-managed OAuth:
  - Frontend redirects to `https://auth.emergentagent.com/?redirect=<url>`.
  - Web: full-page redirect returns `#session_id=...`; parsed in `consumePendingWebSession()` **before** the initial `/auth/me` refresh (race fixed).
  - Mobile: `WebBrowser.openAuthSessionAsync`.
  - Backend `/auth/google-session` verifies the session_id against `https://demobackend.emergentagent.com/auth/v1/env/oauth/session-data`, upserts user by email, issues our JWT.
- **JWT**: HS256, 24h TTL (`JWT_ACCESS_MINUTES=1440`), payload `{sub: user_id, exp, iat}`. Verified via `HTTPBearer` FastAPI dependency in every protected route.
- **Password reset**: forgot → OTP → reset endpoints. Same OTP collection with `purpose: "reset"`.

### 8.2 Partially implemented
- **Rate limiting on OTP endpoints** — none.
- **Refresh tokens** — none. Single access token; user must re-login every 24 h.
- **Account lockout / brute-force protection** — none.
- **Real system SMTP for OTPs** — code exists (`send_system_email`), env not set.

### 8.3 Recommended for production
- 🔴 Add refresh tokens (rotating, 30-day) stored in Mongo, hashed.
- 🔴 Add per-IP + per-email rate limit on `/auth/*` (§22).
- 🔴 Configure a transactional email provider for `SYSTEM_SMTP_*` (SendGrid, SES, Postmark, Resend). Delete the `dev_otp` fallback in production builds.
- 🟠 Optional: WhatsApp OTP via Twilio/MSG91/Firebase (product wants this; keys are the blocker).
- 🟠 Add "sign in with Apple" if targeting iOS App Store (required for social login apps).

---

## 9. Email architecture

### 9.1 What ships (routes/campaigns.py + email_utils.py)
- **Per-user SMTP** — user configures Gmail app-password / Yahoo / custom in `Settings → Email` (single legacy or multi-account).
- **System SMTP** — separate env-driven config for OTPs (`SYSTEM_SMTP_*`).
- **Send path**: synchronous, in-request. For each recipient:
  1. Quota check — free daily cap (§10) and per-recipient 3/rolling-7-day rate limit (`campaign_history.count_documents`).
  2. Variable render — `render_vars()` substitutes `{{ContactName}}`, `{{CompanyName}}`, `{{Designation}}`, `{{City}}`, `{{Industry}}`.
  3. `smtplib.SMTP` (or `SMTP_SSL` for port 465), STARTTLS, login, `sendmail`.
  4. Insert a `campaign_history` document (status=sent|failed).
- **Attachments** — base64 in the campaign document; decoded per-recipient and MIMEBase-attached (not deduped in the SMTP session).
- **Delivery report** — response includes per-email `{email, status, error?}`.

### 9.2 What's NOT implemented
- ❌ Retry on temporary SMTP failures.
- ❌ Queue / background worker — a 500-recipient campaign holds a single HTTP request for minutes.
- ❌ Open / click tracking (`opened_count`, `clicked_count` fields exist but are never incremented).
- ❌ Bounce handling.
- ❌ Unsubscribe links / suppression list.
- ❌ SPF/DKIM/DMARC helper — user's responsibility today.
- ❌ Gmail OAuth (product asked, deferred).

### 9.3 Recommended for production
- 🔴 **Move sends to a background worker** (§17). API endpoint returns immediately; worker sends and updates status. Frontend polls `/campaigns/{id}` or subscribes to SSE.
- 🔴 **Suppression list** — one collection, respected before every send.
- 🔴 **Auto-unsubscribe** — inject a footer link, endpoint marks contact as unsubscribed.
- 🟠 **Open/click tracking** — 1×1 pixel URL + redirect URLs; increment counters on the tracked endpoint.
- 🟠 **Bounce handling** — use provider webhooks (SES/SendGrid) or IMAP inbox monitoring for MDNs.
- 🟠 **Templates → MJML** compile-time render for better client compatibility.

---

## 10. Subscription & payments (Razorpay)

### 10.1 Plan model (plans.py — currently implemented)

| Plan | ₹/month | ₹/year | Daily recipient cap | Feature flags |
|---|---|---|---|---|
| Free | 0 | 0 | **2** | scan, contacts, enrich |
| Basic | 100 | 1,000 | ∞ | + email_campaign, ai_email, templates, attachments, excel_import, excel_export |
| Pro | 200 | 2,000 | ∞ | + whatsapp_campaign, whatsapp_templates |

Free trial: `FREE_TRIAL_DAYS = 14`. Anti-spam rules baked in even for paid plans: max **3 emails / recipient / 7 rolling days**.

`get_effective_plan(user)` downgrades a paid user back to free if `subscription_current_period_end < now`.

### 10.2 Razorpay flow (routes/billing.py)
- `GET /billing/status` — plan + quota usage + `razorpay_configured` flag.
- `POST /billing/checkout` — creates a Razorpay order (amount in paise). **Currently 503** because `RAZORPAY_KEY_ID/SECRET` are blank.
- `POST /billing/verify` — validates the payment signature (razorpay SDK's `utility.verify_payment_signature`), sets `user.plan`, `subscription_current_period_end = now + 30d|365d`, marks `billing_orders.status = paid`.
- `POST /billing/cancel` — flips plan back to free.
- `GET /billing/history` — paid orders.

### 10.3 Partially implemented
- `razorpay` Python SDK is imported lazily and would need to be added to `requirements.txt` (currently missing — will `ImportError` on first checkout after keys are set).
- Frontend has a `plans.tsx` screen with monthly/yearly toggle and cancel button.
- Frontend WebView flow for `Razorpay Checkout` HTML is not yet built — `react-native-webview` is installed but not wired into billing.

### 10.4 Recommended for production
- 🔴 Add `razorpay>=1.4.2` to requirements.
- 🔴 Implement webhook endpoint `POST /billing/webhook` (`razorpay.utility.verify_webhook_signature`) so payment reconciliation doesn't depend on the client. Store `RAZORPAY_WEBHOOK_SECRET`.
- 🔴 Build the WebView checkout screen (`app/billing/checkout.tsx`) — load Razorpay Standard Checkout HTML, catch `payment.success`, POST verify.
- 🟠 For iOS App Store, in-app purchases (StoreKit) are required for consumables/subscriptions unless the payment is for services delivered outside the app. Confirm with Apple guidelines; alternately, launch web-only paid tier on iOS.
- 🟠 Add proration + upgrade/downgrade endpoints.

---

## 11. Multi-language (i18n) architecture

### 11.1 Currently implemented (src/i18n)
- **11 bundled languages**: English, Hindi, Marathi, Gujarati, Tamil, Telugu, Kannada, Malayalam, Bengali, Punjabi, Odia.
- Each language is a `strings.<code>.ts` map (~253 keys per file). All bundles imported at module load — instant switch.
- `I18nProvider` stores selected `lang` in AsyncStorage (`cardvault_lang`).
- `useT()` hook resolves keys with English fallback.
- Language picker shown on first launch, changeable from `Settings → Language`.

### 11.2 Recommended for production
- 🟢 Move to `i18n-js` or `formatjs` for pluralisation and date/number formatting per locale.
- 🟢 Extract bundles to remote (S3 + version) so translation updates don't require an app-store release.
- 🟢 Add RTL support flag for Urdu/Arabic if the roadmap expands.

---

## 12. Excel import/export architecture (routes/excel.py + excel_utils.py)

### 12.1 Import
- Client base64-encodes the .xlsx and POSTs to `/contacts/import/preview` first for a dry run.
- Preview builds two Python sets (`existing_emails`, `existing_phones[-10:]`) once, then classifies each row as `new | update | failed`.
- Commit builds two dicts (`email_index`, `phone_suffix_index`) once, then:
  - Row hits email index → merge (fill blanks + union tags).
  - Row hits phone-suffix index (last-10-digit match) → merge.
  - New row → insert + register in indexes (so second occurrence in same file is treated as merge, not double-insert).
- Result: **O(N+M) instead of O(N×M)**. 36-row upload against 15 existing contacts finishes in 65 ms.
- Gated by `has_feature("excel_import")` → 402 for free users.

### 12.2 Export
- Filters by `contact_ids | search | tag | industry | country | state | city | favorite`.
- openpyxl workbook with styled header (dark navy fill, white bold), frozen top row, 22-char columns.
- Returned as base64 in JSON so the client can save with `expo-file-system` + share.
- Gated by `has_feature("excel_export")`.

### 12.3 Template
`GET /contacts/import/template` returns a styled xlsx with a sample row and a README sheet.

### 12.4 Recommended for production
- 🟠 For imports > 5,000 rows, switch to streamed multipart upload (fastapi `UploadFile`) and stream parse.
- 🟢 Emit a background job for imports > 1,000 rows; return a job id and let the client poll.

---

## 13. Duplicate detection & merging

### 13.1 Currently implemented (routes/contacts.py)
- `GET /contacts/duplicates` — full scan of the user's contacts; two dicts keyed by lowercased email and by last-10-digit phone suffix. Groups with > 1 entry are returned (dedup by sorted-id tuple to avoid double-listing).
- `POST /contacts/merge` — client picks `primary_id` + `duplicate_ids[]`. For each duplicate: blank fields on primary get filled, `tags` union'd, then duplicate is deleted. Primary `updated_at` bumped.
- Inline `DUPLICATE` badge on the contact list — computed client-side from the duplicates endpoint.

### 13.2 Recommended for production
- 🟠 Fuzzy matching (Levenshtein/rapidfuzz) on `name + company` for near-duplicates.
- 🟠 Server-side merge audit log (who merged what, when, with which fields overwritten).

---

## 14. Templates architecture

### 14.1 Currently implemented
- Two collections: `templates` (email) and `wa_templates` (WhatsApp).
- CRUD endpoints under `/templates` and `/whatsapp/templates`.
- Body stored raw HTML (email) / plain text (WhatsApp). Variables use `{{Var}}` syntax.
- WhatsApp templates gated by `whatsapp_templates` feature (Pro).

### 14.2 Recommended
- 🟢 Ship a starter library (10 curated templates) seeded on first login.
- 🟢 Add versioning so campaigns keep sending the version they were composed with even if the template is edited later.

---

## 15. WhatsApp architecture

### 15.1 Currently implemented
- **No WhatsApp Business API needed.** The backend generates `wa.me` deep links.
- `POST /whatsapp/generate-links` — takes body text + contact_ids, filters contacts with a phone, renders variables, returns `[{contact_id, name, phone, url: "https://wa.me/<digits>?text=<encoded>", personalized}]`.
- Frontend `whatsapp.tsx` opens each URL — user's native WhatsApp handles the send.
- Gated by `whatsapp_campaign` feature (Pro).

### 15.2 Partially implemented
- WhatsApp OTP for phone verification (product wants for signup) — blocked on provider choice (Twilio/MSG91/Firebase). No code yet.

### 15.3 Recommended
- 🟠 For real automation, migrate to a BSP (Twilio WhatsApp / MSG91 / Gupshup) with template messages and opt-in flow — required for outbound before user replies.
- 🟢 Track link opens with a redirect service (`/wa/redirect?to=...&contact=...`).

---

## 16. Notifications

### 16.1 Currently implemented
❌ **None.** No push notification integration. No in-app notification center.

### 16.2 Recommended for production
- 🟠 Add Emergent-managed push notifications (deferred by user in the PRD). Requires:
  - Firebase project + `google-services.json` for Android.
  - APNs auth key + team ID for iOS.
  - Only testable after generating a real build (not Expo Go).
- 🟢 In-app notification center backed by a `notifications` collection.

---

## 17. Background jobs / Redis / queues

### 17.1 Currently implemented
❌ **Nothing.** All work happens in the request thread. No Redis, no Celery/RQ, no BullMQ, no APScheduler.

### 17.2 Recommended for production (this is the single most impactful upgrade)
- 🔴 **Redis 7** (single node fine to start, Elasticache/Memorystore/Upstash for managed) — $10–25/mo.
- 🔴 **RQ or Dramatiq** (Python-native, simple). Queue key jobs:
  - `send_campaign` — replaces synchronous `/campaigns/{id}/send`.
  - `enrich_contact` — fires async after a scan.
  - `import_excel` — for large uploads.
  - `retry_failed_email` — exponential backoff.
- 🔴 **APScheduler** for cron tasks:
  - Downgrade users past subscription end (nightly).
  - Delete expired OTPs (or use TTL index).
  - Nightly Mongo dump.
- 🟠 Also add Redis caching for `/contacts/facets`, `/analytics`, `/billing/status`.

---

## 18. Security, encryption, secrets & privacy

### 18.1 Currently implemented
- JWT signed HS256 with `JWT_SECRET` env var (currently a placeholder — **must be rotated**).
- bcrypt password hashing, rounds=12.
- HTTPS terminated by Emergent ingress.
- Multi-tenancy: every backend query filters by `user_id` from the JWT — verified in every route.
- No SQL injection surface (Mongo + Pydantic).

### 18.2 Gaps (must fix before launch)
- 🔴 `JWT_SECRET` is a hard-coded placeholder in `.env`. Rotate to a cryptographically random 512-bit key via a secrets manager.
- 🔴 CORS is `*`. Restrict to app URLs.
- 🔴 SMTP passwords stored **plaintext** in Mongo (`email_configs.smtp_pass`, `email_accounts.smtp_pass`). Wrap in AES-GCM with a KMS-managed key.
- 🔴 No rate limiting anywhere. Add `slowapi` middleware:
  - `/auth/*` → 10 req/min/IP.
  - `/ocr/scan` → 30 req/min/user.
  - `/ai/write-email` → 20 req/min/user.
- 🔴 OTP endpoint returns `dev_otp` when SMTP unset — must be `#ifdef dev` in prod builds.
- 🔴 Base64 attachments up to Mongo's 16 MB cap without a size guard — add `Content-Length` check + Pydantic `max_length` on `content_b64`.
- 🟠 No CSP / security headers on backend (add `starlette.middleware.trustedhost` + `secure` package).
- 🟠 No audit log — add a `audit_events` collection (login, plan change, export, mass delete).

### 18.3 Privacy / compliance
- 🔴 Privacy Policy + Terms of Service — required for Play Store and App Store listings.
- 🔴 DPA (Data Processing Agreement) with Mongo host and email provider.
- 🟠 GDPR/DPDP: `POST /account/export-data` and `DELETE /account` endpoints.

---

## 19. Analytics architecture

### 19.1 Currently implemented (routes/analytics.py)
- Aggregations run live on Mongo (no cache):
  - `contacts_total`, `scans_this_month`, `campaigns_total`, `emails_sent`.
  - Top 8 industries + top 8 countries.
  - 30-day contact growth (`$dateToString` grouped by day).
- Frontend `analytics.tsx` renders bar + pie charts with `react-native-svg`.

### 19.2 Recommended for production
- 🟠 Add `Redis` cache with 5 min TTL for the analytics response.
- 🟠 Add product analytics (PostHog / Amplitude) for funnel tracking — signup → first scan → first campaign → paid.

---

## 20. Logging, monitoring, error tracking

### 20.1 Currently implemented
- `logging` module standard config, name = `cardvault`.
- Everything logs to stdout, captured by supervisord → `/var/log/supervisor/backend.err.log`.
- No structured logging, no correlation IDs, no external log aggregation.
- No APM, no error tracking.

### 20.2 Recommended for production
- 🔴 **Sentry** — free tier covers MVP. Add `sentry-sdk[fastapi]` and `@sentry/react-native`. ~$26/mo team plan when scaling.
- 🔴 **Structured JSON logs** with `structlog`; ship to Grafana Loki / Datadog / BetterStack.
- 🔴 **Uptime monitoring** — BetterStack / UptimeRobot ping `/healthz` from 3 regions.
- 🟠 Metrics — prometheus_fastapi_instrumentator + Grafana (or Datadog APM).

---

## 21. Testing

### 21.1 Currently implemented
- `backend/tests/` — pytest suite; latest iteration 6 has 32 passing cases covering the whole router surface + Excel perf.
- No frontend unit tests, no e2e (Detox / Playwright).
- Test creds in `/app/memory/test_credentials.md`.

### 21.2 Recommended
- 🟠 GitHub Actions job running pytest on every PR.
- 🟠 Detox or Maestro for critical mobile flows (login → scan → save → send campaign).
- 🟠 Playwright for web preview smoke.

---

## 22. Rate limiting & abuse

### 22.1 Not implemented
🔴 Nothing today.

### 22.2 Recommended
```python
# backend/deps.py additions
from slowapi import Limiter
limiter = Limiter(key_func=lambda r: r.headers.get("X-Real-IP") or r.client.host)

# per-route
@router.post("/auth/signup"); @limiter.limit("5/minute")
@router.post("/auth/login");  @limiter.limit("10/minute")
@router.post("/ocr/scan");    @limiter.limit("30/minute", key_func=lambda r: r.state.user_id)
```

---

## 23. Environment configuration

### 23.1 Currently in use

**backend/.env**
```
MONGO_URL=mongodb://localhost:27017
DB_NAME=cardvault_db
JWT_SECRET=<placeholder — ROTATE>
JWT_ACCESS_MINUTES=1440
EMERGENT_LLM_KEY=sk-emergent-... (Universal Key)
SYSTEM_SMTP_HOST=            # blank → dev_otp path
SYSTEM_SMTP_PORT=587
SYSTEM_SMTP_USER=
SYSTEM_SMTP_PASS=
SYSTEM_SMTP_FROM="CardVault <no-reply@cardvault.app>"
RAZORPAY_KEY_ID=             # blank → checkout 503
RAZORPAY_KEY_SECRET=
RAZORPAY_WEBHOOK_SECRET=
```

**frontend/.env** (managed — do not edit)
```
EXPO_TUNNEL_SUBDOMAIN=ocr-contacts-hub-1
EXPO_PACKAGER_HOSTNAME=https://ocr-contacts-hub-1.preview.emergentagent.com
EXPO_PUBLIC_BACKEND_URL=https://ocr-contacts-hub-1.preview.emergentagent.com
EXPO_PACKAGER_PROXY_URL=<same>
```

### 23.2 Recommended for production
Add to secret manager (AWS Secrets Manager / Doppler / 1Password Connect):
- `SENTRY_DSN_BACKEND`, `SENTRY_DSN_MOBILE`
- `REDIS_URL`
- `S3_BUCKET`, `S3_ENDPOINT`, `AWS_ACCESS_KEY_ID`, `AWS_SECRET_ACCESS_KEY` (or Emergent Object Storage tokens)
- `SYSTEM_SMTP_*` — real values (SES/SendGrid credentials)
- `RAZORPAY_*` — production credentials + webhook secret
- `KMS_KEY_ID` — for at-rest field encryption

---

## 24. Deployment architecture (recommended)

### 24.1 What we have today
Emergent preview pod — supervisord runs mongod + uvicorn + expo in one container. Great for dev, unsuitable for production traffic.

### 24.2 Recommended production topology

```
                         ┌──────────────────┐
User → Play/App Store →  │  Mobile app (RN) │
                         └────────┬─────────┘
                                  │ HTTPS
                                  ▼
                    ┌──────────────────────────────┐
                    │  Cloudflare (DNS + WAF + CDN)│
                    │  api.cardvault.app           │
                    │  www.cardvault.app  ← web    │
                    └────────┬──────────┬──────────┘
                             │          │
                             │          └─── S3 / R2 (avatars, attachments)
                             ▼
                 ┌───────────────────────────────┐
                 │  Load balancer (ALB / Fly)    │
                 └────┬───────────┬──────────────┘
                      ▼           ▼
              ┌───────────┐  ┌───────────┐
              │ API pod 1 │  │ API pod 2 │  gunicorn -w 4 uvicorn.workers
              └───────────┘  └───────────┘
                      │           │
                      └─────┬─────┴──────────────────┐
                            ▼                        ▼
                  ┌──────────────┐         ┌─────────────────┐
                  │ RQ workers   │         │ MongoDB Atlas   │
                  │  (2 pods)    │──Redis──│ M10 replica set │
                  └──────────────┘         └─────────────────┘
                            │
                            └──── outbound → SES / SendGrid, Razorpay, Emergent LLM
```

### 24.3 Hosting choices (any of these works, pick one)

| Component | Option A (cheapest) | Option B (managed) |
|---|---|---|
| API + workers | Fly.io / Railway | AWS ECS Fargate / Google Cloud Run |
| DB | Atlas M0 (free) → M10 ($57/mo) | Same (Atlas is on all clouds) |
| Redis | Upstash serverless ($0.20/100k) | Elasticache t4g.micro (~$12/mo) |
| Object storage | Cloudflare R2 (no egress) | AWS S3 |
| DNS + CDN | Cloudflare free | Cloudflare Pro |
| Email | AWS SES (~$0.10/1k) | Resend / Postmark |
| SMS/WhatsApp OTP | Twilio Verify ($0.05/verify) | MSG91 |
| Error tracking | Sentry free | Sentry Team $26/mo |

### 24.4 CI/CD (recommended)

GitHub Actions:
1. `pull_request` → lint (ruff + eslint) + pytest + type-check (mypy + tsc).
2. `push main` → build Docker image → push to registry → deploy to Fly/ECS via API.
3. Mobile: EAS Build (managed by Emergent's `Publish`) → EAS Submit to Play Console + App Store Connect.

---

## 25. Play Store / App Store production requirements

### 25.1 Play Store (Android)
- **Bundle**: AAB via EAS Build.
- **Package**: `com.emergent.ocrcontactshub.il4pkf` (change to your company reverse-domain, e.g. `app.cardvault`).
- **Signing**: Play App Signing.
- **Permissions declared**: `CAMERA`, `READ_EXTERNAL_STORAGE` (added to `app.json`).
- **Data safety form**: declare — email, name, phone, contacts (input by user), images, device ID (via SecureStore), no ads, no third-party analytics unless we add PostHog etc.
- **Privacy Policy URL**: required.
- **Content rating**: business — likely Everyone.
- **Target API level 34** (Android 14) — Expo SDK 54 handles this.

### 25.2 App Store (iOS)
- **Bundle ID**: `com.emergent.ocrcontactshub.il4pkf` — needs to match an App ID in Apple Developer Portal.
- **`NSCameraUsageDescription`**, `NSPhotoLibraryUsageDescription` — set in `app.json`.
- **Sign in with Apple** — required if Google Sign-In is offered. **Not yet implemented.**
- **In-App Purchases** — subscriptions bought inside the app must use StoreKit. Options:
  a) Sell subscription on web (`plans.cardvault.app`) and don't offer paid tier in iOS app (Netflix model — allowed since 2022 with "Reader" entitlement).
  b) Add StoreKit + auto-renewable subscription for iOS users.
- **App Tracking Transparency**: N/A unless we add tracking SDKs.
- **Encryption export declaration**: yes — uses standard TLS + bcrypt.

---

## 26. Environments — dev / staging / production

Current: only one (Emergent preview). Recommended:

| Env | Purpose | Backend | DB | Domain |
|---|---|---|---|---|
| local | dev laptop | uvicorn + docker mongo | localhost | localhost |
| preview (Emergent) | rapid iteration | current pod | container mongo | ocr-contacts-hub-1.preview.emergentagent.com |
| staging | QA + client demos | Fly.io app-staging | Atlas M0 | staging.cardvault.app |
| production | end users | Fly.io app-prod (2 pods) | Atlas M10 replica set | api.cardvault.app |

Promotion: git tag → GitHub Action deploys to staging → smoke test → manual approval → deploy to production. Feature flags via env vars.

---

## 27. Cost estimate

### 27.1 MVP (0–1,000 MAU)

| Item | Cost |
|---|---|
| Fly.io API (shared-cpu-1x, 2 instances) | $5–10/mo |
| Atlas M0 or M2 shared | $0–$9/mo |
| Upstash Redis (free tier) | $0 |
| Cloudflare R2 (10 GB) | $0.15/mo storage + $0 egress |
| Cloudflare DNS | $0 |
| Domain (`cardvault.app`) | ~$12/yr |
| Emergent LLM key top-up (~1k scans + 500 AI-writes / mo) | ~$15/mo |
| AWS SES (~5k emails/mo) | $0.50/mo |
| Sentry free | $0 |
| **Total** | **~$25–40/mo** |

### 27.2 Growth (10k MAU)

| Item | Cost |
|---|---|
| Fly API (2×2GB) + 2 workers | ~$60/mo |
| Atlas M10 replica set | $57/mo |
| Elasticache/Upstash | $10–25/mo |
| R2 (200 GB avatars + attachments) | $3/mo |
| SES (150k emails) | $15/mo |
| Emergent LLM (10k scans + AI writes) | ~$150/mo |
| Twilio Verify (2k OTPs) | $100/mo |
| Sentry Team | $26/mo |
| BetterStack uptime | $10/mo |
| **Total** | **~$430–500/mo** |

---

## 28. Complete data flows — major user journeys

### 28.1 New user signs up + scans first card
```
1. User opens app → I18nProvider loads → RouterGate sees no user → /welcome.
2. User taps "Sign up" → POST /api/auth/signup {name,email,password}.
   Backend inserts user (email_verified=false), generates OTP, inserts /otps,
   returns {message, dev_otp?} (dev_otp only when SYSTEM_SMTP is blank).
3. verify-otp screen → POST /api/auth/verify-otp → returns {access_token, user}.
   AuthProvider stores token in SecureStore + user in AsyncStorage → redirect (tabs).
4. User taps "Scan" → expo-camera → capture → expo-image-manipulator resize →
   base64 encode → POST /api/ocr/scan {image_b64}.
5. Backend: OpenCV face crop → Claude vision → returns 16 fields + avatar_b64.
6. scan-review.tsx displays parsed fields; user edits.
7. User taps "Save" → POST /api/contacts (source:"ocr", stores image_b64 + avatar_b64).
```

### 28.2 Google Sign-In (web)
```
1. GoogleAuthButton → redirect to https://auth.emergentagent.com/?redirect=<origin>.
2. Emergent handles Google OAuth → redirects back with #session_id=...
3. AuthProvider mount → consumePendingWebSession() reads #session_id →
   POST /api/auth/google-session {session_id}.
4. Backend calls Emergent /oauth/session-data with X-Session-ID header,
   upserts user by email, mints our JWT → returns {access_token, user}.
5. AuthProvider stores JWT → refresh() → GET /api/auth/me → UI unlocks.
```

### 28.3 Email campaign send (500 recipients)
```
1. New campaign wizard: user picks recipients (filter facets), composes body
   (uses /ai/write-email + template picker), attaches PDF (base64), reviews.
2. POST /api/campaigns → resolves recipients (filters + dedup by email),
   stores draft campaign doc.
3. POST /api/campaigns/{id}/send → for each recipient:
     • daily quota check via campaign_history count
     • 3-per-7-day rate limit check
     • render_vars() personalises subject + body
     • smtplib.sendmail with attachments
     • insert campaign_history row
   Response: {sent, failed, skipped_daily_quota, skipped_ratelimit, delivery:[...]}.
4. Campaign doc marked status:"sent", counts updated.
```

### 28.4 Excel import (1,000 rows)
```
1. Client picks .xlsx → base64 → POST /contacts/import/preview.
   Backend parses (openpyxl), classifies each row {new|update|failed} using
   pre-built email/phone-suffix sets. Returns preview[:200] + counts + errors.
2. User confirms → POST /contacts/import/commit with duplicate_strategy.
   Backend builds email_index + phone_suffix_index once (O(N)), then O(1) lookup
   per row → inserts new / merges updates.
3. Response: {total, imported, updated, duplicate_removed, failed}.
```

### 28.5 Razorpay upgrade to Basic (post-key-setup)
```
1. plans.tsx → POST /billing/checkout {plan:"basic", cycle:"monthly"}.
2. Backend creates Razorpay order (amount 10000 paise), stores billing_orders.
3. App opens Razorpay WebView with checkout HTML → user pays → JS bridge
   posts back {order_id, payment_id, signature}.
4. App → POST /billing/verify → backend verifies signature →
   sets user.plan=basic, subscription_current_period_end=+30d → returns ok.
5. Optional: webhook POST /billing/webhook (recommended) verifies via
   RAZORPAY_WEBHOOK_SECRET for reconciliation even if user drops the app.
```

---

## 29. Production launch checklist

### Backend
- [ ] Rotate `JWT_SECRET` to a 512-bit random string; store in secrets manager.
- [ ] Lock CORS to `["https://cardvault.app","https://www.cardvault.app", app schemes]`.
- [ ] Add all Mongo indexes listed in §4.4.
- [ ] Add `slowapi` rate limits on `/auth/*`, `/ocr/scan`, `/ai/*`.
- [ ] Encrypt SMTP passwords + attachments at rest (KMS-wrapped AES-GCM).
- [ ] Add `/healthz` + `/readyz` + `sentry_sdk` init.
- [ ] Configure `SYSTEM_SMTP_*` (SES) and remove `dev_otp` from prod builds.
- [ ] Add `razorpay` to requirements + implement webhook endpoint.
- [ ] Add gunicorn + uvicorn workers (`-w 4`).
- [ ] Deploy Redis + RQ workers + move campaign send to background.
- [ ] Set up nightly Atlas backup + retention policy.

### Frontend
- [ ] Update `app.json` bundle IDs to prod (`app.cardvault.android`, `app.cardvault.ios`).
- [ ] Add "Sign in with Apple" if Google Sign-In stays for iOS.
- [ ] Wire up Razorpay WebView checkout.
- [ ] Add `@sentry/react-native`.
- [ ] Replace `EXPO_PUBLIC_BACKEND_URL` with `api.cardvault.app` in production builds.
- [ ] EAS Build config with prod signing certs (Play Signing + Apple Distribution).
- [ ] Screenshots (5 per platform, 3 device sizes).
- [ ] Store listing text + privacy policy URL.

### Infra
- [ ] Domain purchased + Cloudflare DNS with API + web hosts.
- [ ] TLS via Cloudflare or Let's Encrypt on the API host.
- [ ] Atlas M10 replica set + private link to API pod.
- [ ] Object storage bucket + signed-URL upload helper.
- [ ] Uptime monitoring on `/healthz` from 3 regions.
- [ ] GitHub Actions pipeline: pytest → build → deploy → notify Slack.

### Legal / product
- [ ] Privacy Policy & Terms hosted at `cardvault.app/privacy` and `/terms`.
- [ ] Cookie / tracking disclosure if analytics added.
- [ ] DPA with Mongo host + email provider.
- [ ] Data export + delete endpoints (`/account/export`, `DELETE /account`).

---

## 30. Future scalability & recommended improvements (ranked)

1. 🔴 **Move sends + heavy work to Redis+RQ** — unblocks large campaigns and gives retries.
2. 🔴 **Object storage for images/attachments** — Mongo doc sizes stay bounded.
3. 🔴 **Real system SMTP + drop `dev_otp`** — closes an obvious auth hole.
4. 🔴 **Atlas M10 + backups + PITR** — no more single-container DB.
5. 🔴 **Rate limiting + audit log** — abuse floor.
6. 🟠 **Push notifications** — retention lever; also enables campaign progress updates.
7. 🟠 **Open/click tracking + suppression list** — makes campaigns feel professional.
8. 🟠 **Sign in with Apple** + real Razorpay WebView — unblocks iOS + iOS purchases.
9. 🟠 **Fuzzy duplicate detection** — better data quality.
10. 🟢 **On-device ML Kit OCR preview + server-side vision** — instant UX, keeps accuracy.
11. 🟢 **Fine-grained subscription plans** (Team seats, Enterprise SSO).
12. 🟢 **Public API keys for enterprise users** to POST contacts programmatically.

---

## 31. Cheat-sheet — for every major component

| Component | What | Where hosted | Why | Connects to | Cost | Maintenance |
|---|---|---|---|---|---|---|
| Mobile app | Expo RN 0.81 + expo-router | Users' devices (Play/App Store) | Cross-platform, one codebase | `/api/*` via HTTPS + Bearer JWT | $99/yr Apple + $25 Google (one-time) | EAS Build; monthly patch releases |
| Web preview | Expo web on port 3000 | Emergent pod (dev) → later Cloudflare Pages | Fast QA loop; PWA fallback | Same backend | $0 (Cloudflare free) | Auto-deploy on push |
| FastAPI backend | Python 3.11 + uvicorn | Emergent pod → later Fly.io / ECS | Async, ergonomic, Pydantic-typed | Mongo, Emergent LLM, SMTP, Razorpay | $5–60/mo | GitHub Actions CI/CD |
| MongoDB | 8 collections | localhost (today) → Atlas M10 | Schemaless, matches product shape | Motor driver from API | $0 → $57/mo | Atlas manages backups/patches |
| Redis (planned) | Job queue + cache | Upstash / Elasticache | Async sends, rate-limit store | RQ workers | $10–25/mo | Managed |
| Object storage (planned) | Avatars, cards, attachments | Cloudflare R2 / Emergent Object Storage | Off-load bytes from Mongo | Backend + CDN | $0.15/GB, no egress | Managed |
| Emergent LLM | Claude Haiku vision + text | Emergent-managed | Best-in-class OCR without native deps | Backend outbound HTTPS | ~$0.001–0.003/scan | Top-up Universal Key |
| Emergent Google Auth | OAuth broker | Emergent-managed | Zero-config Google Sign-In | Backend + mobile WebBrowser | $0 | Managed |
| SMTP | User-configured (Gmail app-pw / SES / custom) | User's account or SES | Legal deliverability & existing rep | Backend `smtplib` | $0.10/1k (SES) | User rotates app-passwords |
| Razorpay | Payments | Razorpay dashboard | Preferred in IN + INR support | Backend orders + verify + webhook | 2% + GST per txn | Reconcile via webhook |
| Sentry (planned) | Errors + performance | Sentry cloud | Diagnose issues in prod | Backend + mobile SDKs | $0–$26/mo | Auto-alerts |
| Cloudflare | DNS + WAF + CDN | Cloudflare | TLS, DDoS, edge caching | Public entry point | $0 | Managed |

---

## 32. Appendix — repo cheat-sheet

**Repo root**: `/app`

Key protected files (never modify):
- `/app/frontend/.env` (packager URLs)
- `/app/frontend/metro.config.js`
- `/app/backend/.env` — `MONGO_URL` line only (rest editable)

Where to find things:
- Add a new backend endpoint → `backend/routes/<domain>.py` + schema in `backend/schemas.py`.
- Add a new plan feature → append to `backend/plans.py`.
- Add a new screen → `frontend/app/<name>.tsx` (expo-router).
- Add a translation key → all 11 `frontend/src/i18n/strings.<lang>.ts`.
- Change API base → **only** through `EXPO_PUBLIC_BACKEND_URL` in `frontend/.env`.
- Restart backend → `sudo supervisorctl restart backend`.
- Restart expo → `sudo supervisorctl restart expo`.
- Backend logs → `/var/log/supervisor/backend.err.log`.
- Test creds → `/app/memory/test_credentials.md`.
- Latest test report → `/app/test_reports/iteration_6.json`.

---

*End of document. Update on every material architectural change; sign under §doc version.*
