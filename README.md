# Famous-Game

Mobile-first React + Vite application with:
- Supabase email + Google sign-in
- In-game currency ledger (`Foxy Pesos`, `FP`) where `1 FP = 1 satoshi`
- Server-authoritative Cashu custody (redeem + withdraw through Supabase Edge Functions)

## 1. Local Setup

1. Install dependencies:
```bash
npm ci
```
2. Create `.env` from `.env.example`:
```env
VITE_SUPABASE_URL=https://your-project-ref.supabase.co
VITE_SUPABASE_ANON_KEY=your-anon-key
```
3. Start the app:
```bash
npm run dev -- --host --force
```

## 2. Supabase Auth Setup

In Supabase dashboard:

1. Go to `Authentication -> URL Configuration`.
2. Set `Site URL`:
- Local: `http://localhost:5173`
- Production: your deployed URL
3. Add redirect URLs:
- `http://localhost:5173/auth/callback`
- `https://your-production-domain/auth/callback`
4. In `Authentication -> Providers`, enable Email and Google as desired.

For email-code mode template:
- Use `{{ .Token }}`

For link mode template:
- Use `{{ .ConfirmationURL }}`

## 3. Authoritative Wallet SQL

Apply the SQL file:
- [wallet_authoritative.sql](/C:/codex/Famous-Game/supabase/sql/wallet_authoritative.sql)

This creates:
- `wallet_proofs` (server-side proof custody)
- `wallet_requests` (idempotency + request tracking)
- `wallet_profiles`, `wallet_ledger` hardening
- transactional RPC functions used by edge functions

## 4. Deploy Edge Functions

From repo root:

```bash
supabase functions deploy wallet-balance
supabase functions deploy wallet-alias
supabase functions deploy wallet-redeem
supabase functions deploy wallet-withdraw
```

Set edge-function secret allowlist (optional but recommended):

```bash
supabase secrets set CASHU_TRUSTED_MINTS="https://nofee.testnut.cashu.space/"
```

If `CASHU_TRUSTED_MINTS` is empty, all mints are accepted.

## 5. Security Model

- Client does not hold authoritative proofs.
- Redeem and withdraw happen server-side only.
- Redeem credits only after mint acceptance.
- Withdraw reserves proofs transactionally, performs mint send, then finalizes ledger.
- Request IDs provide idempotency and replay protection.
- Balance is derived from unspent server-side proofs, not user-editable client values.

## 6. Build

```bash
npm run build
```
