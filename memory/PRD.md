# CardVault — Business Card OCR + Smart Contact & Campaign Management

Production-ready Android-first (iOS-compatible) Expo React Native app with FastAPI + MongoDB backend.

## What's shipped (through iteration 4)

### Auth
- Email + password signup with 6-digit email OTP (dev fallback: OTP surfaced in API response and a Preview-Mode banner on the OTP screen when SYSTEM_SMTP isn't configured).
- Login, forgot/reset password, resend-OTP.
- JWT bearer tokens; `AuthProvider` in the app.

### OCR + Enrichment
- Business-card scan via `/api/ocr/scan`. Primary engine: **Claude Haiku 4.5 vision** (via `emergentintegrations`, no native deps). Fallback: pytesseract + regex + LLM text parse. Friendly 422 error if both fail.
- OpenCV face-detection auto-crops a **profile-picture avatar** from the card and returns `avatar_b64`; used across the app (list, detail, contacts).
- `/api/enrich` scrapes company website for description, industry hint, LinkedIn/Twitter socials.

### Contacts
- Full CRUD, search, tag/industry/favorite/sort filters.
- Multi-value filters (country, state, city, tag, industry) via `/contacts?tags=..,..`.
- Distinct facets endpoint for filter chips: `/contacts/facets`.
- Case-insensitive normalized tags.
- Separate **Pincode** field.
- **Smart duplicate detection** (email + last-10-digit phone) with:
  - `DUPLICATE` badge inline on contact list.
  - Settings → Manage duplicates screen with one-tap merge (server picks oldest as canonical).
- Notes + Activity + AI-Enrich tabs on contact detail.

### Excel Import & Export (Basic plan and up)
- `POST /contacts/export`: xlsx with styled header and freeze-pane, respects filter/selection.
- `GET /contacts/import/template`: styled sample template with README sheet.
- `POST /contacts/import/preview`: validates + dedupes vs existing contacts, returns preview with per-row action (`new`, `update`, `failed`).
- `POST /contacts/import/commit`: inserts new, merges duplicates (fills blanks + unions tags) or skips based on `duplicate_strategy`.

### AI Email Writing Assistant
- `POST /ai/write-email` — actions: generate, rewrite, shorten, expand, formalize, friendly. Powered by Claude Haiku with strict JSON output. Frontend: bottom-sheet AI assistant in the Campaign composer.

### Campaigns (Email)
- 3-step wizard: choose recipients → compose (template + AI + variables) → review + send.
- Multi-select filters with facets (country, state, city, tag, industry).
- **Variables**: `{{ContactName}}`, `{{CompanyName}}`, `{{Designation}}`, `{{City}}`, `{{Industry}}` rendered per-recipient before send.
- **Attachments** array accepted on the CampaignIn model and MIMEBase-attached at SMTP send time.
- Multi-account SMTP (`/settings/emails` CRUD) with `email_account_id` selectable at send.
- Anti-spam: max 3 emails / recipient / rolling 7 days (enforced server-side, counted in `campaign_history`).

### Campaign Recipient Status
- `GET /contacts/recipient-status` returns per-contact `emails_sent_7d`, `remaining_weekly`, `blocked`, `last_emailed`.

### Subscription (Razorpay plumbing)
- Plans: Free / Basic ₹100·₹1000 / Pro ₹200·₹2000.
- Backend: `/billing/status`, `/billing/checkout`, `/billing/verify`, `/billing/cancel`, `/billing/history`.
- Free trial daily quota (**2 recipients / day**) enforced during campaign send.
- Feature gating helper (`has_feature`, `get_effective_plan`) applied to export, import, WhatsApp.
- Frontend: `/plans` screen with monthly/yearly toggle, current-plan card, cancel, payment history.
- **NOTE**: Razorpay keys not configured → checkout returns 503 with a helpful message. Add `RAZORPAY_KEY_ID` + `RAZORPAY_KEY_SECRET` to `/app/backend/.env` and it activates.

### WhatsApp (Pro plan)
- `POST /whatsapp/generate-links` returns per-contact `wa.me` URLs with variables substituted — **no WhatsApp Business API needed**.
- WhatsApp Templates CRUD (`/whatsapp/templates`) Pro-gated.
- Frontend: `/whatsapp` screen with compose + recipients + one-tap launch flow.

### Multi-language (11 Indian languages)
- I18nProvider, `useT()`, per-language TS bundles. Language picker on first launch and in Settings. English, Hindi, Marathi, Gujarati, Tamil, Telugu, Kannada, Malayalam, Bengali, Punjabi, Odia — all with ~253 translated strings each.

### Analytics
- Totals + 30-day contact-growth bar chart + industry/country pie charts (react-native-svg).

### Settings
- Profile card, Plans & billing, SMTP email(s), Templates, Import/Export, WhatsApp, Manage Duplicates, Analytics, Language, About.

## Testing
- 4 iterations of testing_agent verification. Latest: 16/16 backend tests + all frontend testIDs. Pytest suite lives at `/app/backend/tests/`.
- Seeded test users in `/app/memory/test_credentials.md`:
  - `test2@cardvault.dev` — free
  - `basictester@cardvault.dev` — basic
  - `p2@cardvault.dev` — pro
  - Password for all: `pass1234`.

## Environment configuration
- Backend `.env`: `MONGO_URL`, `DB_NAME`, `JWT_SECRET`, `EMERGENT_LLM_KEY` (Universal Key — required), `RAZORPAY_KEY_ID/SECRET` (optional), `SYSTEM_SMTP_*` (optional — enables real OTP email delivery).
- Frontend `.env`: `EXPO_PUBLIC_BACKEND_URL` (managed).
- User-provided SMTP configured per-account inside the app (Gmail App Password, Yahoo App Password, or Custom SMTP).

## Known future upgrades (not blockers)
- Gmail OAuth (currently App-Password only).
- WhatsApp OTP verification for signup (currently uses email OTP; WhatsApp number optional).
- Real Razorpay checkout (needs keys).
- Split monolithic `server.py` into routers (~1600 lines).
- Rich-text editor (`react-native-pell-rich-editor` or WebView-based) — currently plain-text/HTML text input with variable placeholders.
