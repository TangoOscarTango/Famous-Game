# Famous-Game

Mobile-first React + Vite application with:
- Magic-link email authentication (Supabase)
- In-game currency ledger (`Foxy Pesos`, `FP`) where `1 FP = 1 satoshi`
- Cashu token redemption flow (supports `cashuA` and `cashuB`)

## 1. Local Setup

1. Install dependencies:
```bash
npm ci
```
2. Create `.env` from `.env.example`:
```env
VITE_SUPABASE_URL=https://your-project-ref.supabase.co
VITE_SUPABASE_ANON_KEY=your-anon-key
VITE_CASHU_TRUSTED_MINTS=https://mint1.example,https://mint2.example
```
3. Start the app:
```bash
npm run dev
```

## 2. Supabase Auth Setup (Magic Links)

In Supabase dashboard:

1. Go to `Authentication -> URL Configuration`.
2. Set `Site URL`:
- Local: `http://localhost:5173`
- Production: your deployed app URL
3. Add redirect URLs:
- `http://localhost:5173/auth/callback`
- `https://your-production-domain/auth/callback`
4. In `Authentication -> Providers -> Email`, enable:
- `Email provider`
- `Confirm email` (recommended)
- `Magic link` sign-in
5. In `Authentication -> Email Templates`, configure template content for your chosen mode:
- Magic link mode: include `{{ .ConfirmationURL }}`
- Email code mode: include `{{ .Token }}`

Note: Supabase email OTP and magic link share the same `signInWithOtp` endpoint. The email template decides whether users receive a clickable link or a one-time code.

## 3. Required Tables

Run this SQL in Supabase SQL editor.

```sql
create table if not exists public.user_profiles (
  user_id uuid primary key references auth.users(id) on delete cascade,
  email text not null,
  display_name text not null,
  avatar_url text,
  games_played integer not null default 0,
  messages_sent integer not null default 0,
  times_generated integer not null default 0,
  created_at timestamptz not null default now()
);

create table if not exists public.wallet_profiles (
  user_id uuid primary key references auth.users(id) on delete cascade,
  wallet_alias text,
  balance_sats bigint not null default 0,
  updated_at timestamptz not null default now()
);

create table if not exists public.wallet_ledger (
  id uuid primary key,
  user_id uuid not null references auth.users(id) on delete cascade,
  direction text not null check (direction in ('credit', 'debit')),
  amount_sats bigint not null check (amount_sats > 0),
  source text not null,
  note text,
  status text not null default 'pending_verification',
  created_at timestamptz not null default now()
);
```

## 4. RLS Policies (Baseline)

```sql
alter table public.user_profiles enable row level security;
alter table public.wallet_profiles enable row level security;
alter table public.wallet_ledger enable row level security;

create policy "user_profiles_owner_all"
on public.user_profiles
for all
using (auth.uid() = user_id)
with check (auth.uid() = user_id);

create policy "wallet_profiles_owner_all"
on public.wallet_profiles
for all
using (auth.uid() = user_id)
with check (auth.uid() = user_id);

create policy "wallet_ledger_owner_all"
on public.wallet_ledger
for all
using (auth.uid() = user_id)
with check (auth.uid() = user_id);
```

## 5. Cashu + FP Notes

- The app accepts `cashuA...` and `cashuB...` tokens.
- Redeem is mint-confirmed using `wallet.receive(...)` with DLEQ checks before crediting FP.
- Withdraw is mint-confirmed using `wallet.send(...)` and returns a QR/token payload.
- FP balance is derived from real stored Cashu proofs (`1 FP = 1 sat`).
- Set `VITE_CASHU_TRUSTED_MINTS` to a comma-separated allowlist to reject unknown mints.
- Any Cashu wallet can be used as long as it exports standard `cashuA` or `cashuB` tokens.

## 6. Build

```bash
npm run build
```
