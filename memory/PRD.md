# CardVault — Business Card OCR & Smart Contact Management

## Vision
Turn every paper business card into a searchable, enriched CRM contact — and reach those contacts with targeted email campaigns — all from a single premium mobile app.

## Stack
- **Frontend:** Expo Router (React Native, TypeScript). Bottom-tab nav with elevated FAB Scan.
- **Backend:** FastAPI + Motor (MongoDB), pytesseract for OCR, emergentintegrations (Claude Haiku) for AI field parsing, httpx+BeautifulSoup for web scraping, smtplib for user-owned SMTP.
- **Auth:** Email/password + JWT + 6-digit email OTP.
- **LLM:** Emergent LLM Key (universal) → Anthropic Claude Haiku 4.5 for structured OCR parsing.

## Features shipped in MVP
1. **Auth flow**: signup → OTP verify → auto-login; login; forgot/reset password.
2. **OCR scan**: camera capture with laser overlay + gallery import → backend pytesseract → AI field extraction → editable review screen → save as contact.
3. **Contacts CRUD**: create/list/search/filter (all/recent/favorites/tag)/detail/edit/delete.
4. **Contact detail**: hero header, quick actions (call/email/web/LinkedIn), tabs (Info / Notes / Activity / Enrich).
5. **AI Enrichment**: scrape website for description, industry hints, LinkedIn / Twitter / Facebook links; auto-fills contact.
6. **Duplicate detection & merge**: groups by email/phone, one-tap merge.
7. **Email templates**: create/list/delete.
8. **Campaigns**: 3-step wizard (recipients → compose (with template pick) → review & send) via user's SMTP; anti-spam limit (3/recipient/week).
9. **Analytics**: totals + 30-day growth bar chart + industry & country pie charts.
10. **Settings**: SMTP config with test button (Gmail/Outlook/Yahoo/Custom); templates; duplicates; about.

## Notable UX improvements over spec
- Scan is a center FAB (not a plain tab) — thumb-friendly and always accessible.
- 3-step campaign wizard reduces click count vs the spec's multi-modal flow.
- Contact detail hero + quick-action bar gets user to call/email in ≤1 tap.
- One-tap duplicate merge (server picks oldest as canonical).
- AI-enrich badge next to each enriched field so users see automation value.
- OTP inputs are 6 individual boxes with auto-focus advance.

## Known constraints
- **OCR runs on the backend via Tesseract**, not on-device Google ML Kit (ML Kit requires a native module unavailable in Expo Go). This still fulfills the "Tesseract OCR" requirement from the user; Google ML Kit remains a future upgrade requiring a dev build.
- **System SMTP not configured** — OTPs are logged to backend stderr in dev. Configure `SYSTEM_SMTP_*` in `/app/backend/.env` before production to actually deliver OTPs by email.
- **Campaign delivery uses the user's own SMTP** as requested; no SendGrid/etc.

## Environment
- Backend: `/app/backend/.env` — `MONGO_URL`, `DB_NAME`, `JWT_SECRET`, `EMERGENT_LLM_KEY`, optional `SYSTEM_SMTP_*`.
- Frontend: `/app/frontend/.env` — `EXPO_PUBLIC_BACKEND_URL` (managed by Emergent).

## Testing
- Test credentials: `/app/memory/test_credentials.md`.
- Backend curl smoke tested (signup → OTP → verify → contact CRUD → analytics) — all pass.
