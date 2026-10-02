<div align="center">

<img src="favicon.ico" width="88" alt="AQUA-API">

# AQUA-API

### One endpoint for every AI upstream you own

**Self-hosted LLM API Gateway · AI Usage Management**

Official API keys · Cloud vendors · OpenAI-compatible services · Subscription accounts · Self-hosted models
Unified protocols · Smart routing · Precise billing · A ready-to-use admin console

## 🌐 Official website `https://aqua.is3.cc`

> If the domain ever changes, **this repository is the source of truth** (updated here first).

[![License](https://img.shields.io/badge/License-Mulan%20PSL%20v2-blue.svg)](LICENSE)
[![License](https://img.shields.io/badge/NOTICE-Disclaimer-informational.svg)](DISCLAIMER.md)
[![License](https://img.shields.io/badge/Trademark-statement-informational.svg)](TRADEMARK.md)
[![Go](https://img.shields.io/badge/Go-1.27-00ADD8.svg?logo=go&logoColor=white)](https://go.dev)
[![CGO](https://img.shields.io/badge/CGO-free-success.svg)](#why-aqua-api)
[![Web](https://img.shields.io/badge/Web-Next.js%2016%20%2B%20React%2019-black.svg)](#tech-stack)
[![Deploy](https://img.shields.io/badge/Deploy-single%20binary%20%2F%20Docker-informational.svg)](#-quick-start)
[![Platform](https://img.shields.io/badge/Platform-Linux%20%7C%20macOS%20%7C%20Windows-lightgrey.svg)](#-quick-start)

[简体中文](README.md) ｜ [**English**](README.en.md) ｜ [🌐 Live demo](https://aqua.is3.cc)

</div>

---

## 🔗 Official links

| | Address |
|---|---|
| **Official website (live demo)** | **`https://aqua.is3.cc`** |
| **Primary repository (China)** | `https://gitee.com/xiaosu4610/AQUA-API` |
| **Mirror (GitHub)** | `https://github.com/xiaosu4610/AQUA-API`（synced automatically from Gitee） |

**This repository is the authoritative source for the official address.** If the domain changes,
it is updated **here first** and only then mirrored anywhere else. Bookmarking this repository
is more reliable than bookmarking a domain.

### 🛡 Watch out for imposters

- This project offers and authorises **no** "top-up agent", "managed hosting" or "official shared
  account" services. The server code is fully open source under the
  [Mulan PSL v2](LICENSE) license, so anyone can self-host it —
  **being able to run it does not make a site official.**
- Only the addresses above are official. Any other domain is unrelated to this project, even if the
  UI looks identical.
- We will never DM you asking for passwords, payment credentials or verification codes.
- By using this project you accept the [usage notice and disclaimer](DISCLAIMER.md);
  the boundaries of the brand and trademarks are defined in the
  [trademark statement](TRADEMARK.md).
- To contribute, read [CONTRIBUTING.md](CONTRIBUTING.md) first (Fork + Pull Request;
  the `main` branch is protected).

### Link blocked or unreachable?

These domains are frequently **flagged by social platforms** (QQ / WeChat and similar) — we have
experienced mass reporting ourselves. If a link will not open:

1. Try another browser, or switch networks (mobile data ↔ home broadband);
2. **Share this repository link instead of the bare domain** — code-hosting links are far less
   likely to be blocked, and anyone can confirm the current official address from the repo itself;
3. If you are sure it is a false positive, file an appeal through the platform's own process.

> Questions or feedback? Join the official chat group: **QQ group `1103667832`**
> (entry in the top-right of the site's home page).

---

## 📖 Table of contents

- [🔗 Official links](#-official-links)
- [⚠️ Disclaimer](#️-disclaimer)
- [What is this](#what-is-this)
- [Why AQUA-API](#why-aqua-api)
- [Core features](#core-features)
- [Supported protocols & upstreams](#supported-protocols--upstreams)
- [Tech stack](#tech-stack)
- [Full request lifecycle](#full-request-lifecycle)
- [🚀 Quick start](#-quick-start)
- [Configuration](#configuration)
- [Client integration](#client-integration)
- [Operations guide (groups · agents · billing)](#operations-guide-groups--agents--billing)
- [FAQ](#faq)
- [Roadmap](#roadmap)
- [Development](#development)
- [Contributing](#contributing)
- [License](#license)

---

## ⚠️ Disclaimer

**Read the [usage notice and disclaimer](DISCLAIMER.md) before using this project.**
This project is intended for lawful technical research and internal management only; users must
comply with local laws and the terms of every upstream they connect. The author accepts no
liability for losses arising from its use.

Brand and trademark boundaries: see the [trademark statement](TRADEMARK.md).

---

## What is this

AQUA-API is a **self-hosted LLM API gateway** and an **AI asset (usage) management system**.

Your upstreams are usually a mess of incompatible things: OpenAI keys, Azure, Claude,
Gemini, cloud vendors, resellers, subscription accounts (Claude / Codex / Gemini), and
local models on Ollama or vLLM. Your downstream is your apps: Claude Code, Codex CLI,
Cursor, your own services, scripts, plugins.

AQUA-API sits in between and turns all of it into **one endpoint, one protocol, one clear bill**:

```
                      ┌──────────────────────────────────────────┐
   Claude Code ─┐     │                                          │     ┌─ Official OpenAI keys
   Codex CLI  ──┤     │                AQUA-API                  │     ├─ Azure OpenAI
   Cursor     ──┼────▶│                                          │────▶├─ Anthropic / Gemini
   Your app   ──┤     │  protocols · routing · billing · groups  │     ├─ Cloud vendors / resellers
   Scripts    ──┘     │  pool · console · cost reports · notices │     ├─ Subscription accounts
                      └──────────────────────────────────────────┘     └─ Local Ollama / vLLM
                        OpenAI / Anthropic / Gemini   adapted by channel type
```

It solves exactly three things: **unification** (one protocol, one entry), **reliability**
(automatic avoidance of failures) and **accountability** (every cent traceable).

---

## Why AQUA-API

There is no shortage of proxies. What is scarce is one you can **trust with your books**.
Every row below is a decision made after being burned by the alternative:

| Concern | The usual approach | AQUA-API |
|---|---|---|
| **Upstream keys** | Stored in plaintext, readable in the UI | **AES-256-GCM encrypted at rest**, injected only via env vars — a compromised console yields no usable credentials |
| **Master key** | Written into the config file | The config field is **ignored outright** — it can never leak through the repo |
| **Upstream failures** | Permanently disabled after N failures; the pool shrinks | **Failure classification + cooldown/half-open**: rate limiting is temporary avoidance with automatic recovery; retired only on an explicit "credential revoked" |
| **Retry policy** | Retry everything, or nothing | **Routed by failure type**: 429 → cool down and rotate key; 5xx → switch channel; 401/403 → long cooldown; content filter → switch model; empty 200 → downgrade. **Respects upstream `Retry-After`** |
| **Rate limits** | One global threshold | **Per-credential** (weight / priority / RPM / in-flight); over-limit rotates keys; groups can carry a **per-minute request plan** |
| **Quota** | Checked before and after; concurrent requests overspend | **Reserve → settle → refund**: available = quota − used − reserved. No negative balances under concurrency |
| **Periodic budget** | Only a total quota; you notice when it is spent | Token-level **rolling-window budget** (daily / weekly / monthly) that trips inside the window |
| **Streaming billing** | Reads only the first N bytes; long answers bill **0** | Incremental SSE parsing — a `usage` frame at the very end of the stream is still captured |
| **Protocols** | OpenAI-compatible only | **OpenAI / Anthropic / Gemini** downstream, upstream adapted by channel type |
| **Audience segmentation** | A key is a permission; free and paid cannot be separated | **Groups** decide channels and prices, and **a key picks its group**: same upstream, separate books |
| **Agent/reseller tiers** | Discounts tracked by hand; books never match | **Agent groups**: the plaza shows the agent "list price struck through + discounted price"; the discount *is* the group multiplier, and **plaza price equals what is actually charged** |
| **Pricing flexibility** | One price per model, hard to change | Prices configurable per **model × group × channel**; each ledger row stores a **price-version snapshot**, so old bills can be recomputed after a price change |
| **Cost visibility** | Revenue only, no idea if you profit | **True-cost reconciliation report**: revenue − cost − gross margin by group / channel / model; upstream cost supports per-token and per-call |
| **Operations** | You watch channels by hand | **Channel health panel** + **auto-disable by success rate**; admin console can be locked down with a **CIDR allowlist** |
| **Compliance** | One line in the terms and done | **Site-wide compliance notice system**: terms section + model badges + first-visit acknowledgement + top-up page note |
| **Deployment** | Needs a database, Redis, a compiler | **Single binary + SQLite**, frontend embedded, zero CGO — no gcc required |

---

## Core features

### 🌐 Gateway & forwarding

- **Three downstream protocols**: OpenAI-compatible (`/v1/chat/completions`, `/v1/models`,
  `/v1/embeddings`), Anthropic (`/v1/messages`), Gemini (`/v1beta`) — each can take over its
  native clients directly
- **Upstream adapters**: OpenAI-compatible, **Azure OpenAI** (deployment + api-version),
  **Anthropic**, **Gemini**, **Codex / Responses**, and subscription accounts
- **Canonical intermediate form**: everything converges on the OpenAI protocol (N×1) — adding an
  upstream means writing one "in", a downstream one "out"
- **Bidirectional streaming conversion**: Anthropic / Gemini SSE events ↔ OpenAI
  `chat.completion.chunk`, including tool calls
- **300-second upstream timeout** so long answers are not cut off
- **Faithful error passthrough** (RFC7807 `detail`, OpenAI `error.message`) — errors are never swallowed
- **Observable routing headers**: `X-Routed-Via` (channel actually used),
  `X-Fallback-Attempts` (number of fallback attempts), `X-Upstream` (real upstream model) —
  fallbacks are transparent without packet captures

### 🔑 Credential pool & scheduling

- **Five strategies**: sequential / round-robin / weighted random / least recently used /
  **least in-flight** (default), switchable per channel
- **Per-credential tuning**: weight, priority, per-minute limit, in-flight count, cooldown deadline
- **Failure-classified retries**:
  - `429` → rotate the key and put it into a short cooldown (exponential backoff), honouring `Retry-After`
  - `5xx` / timeout → switch channel and retry
  - `401 / 403 / 402` → long cooldown (never retired hastily, so transient risk-control blocks don't kill good keys)
  - content-filter block → switch model
  - `200` with empty content → treated as a failure and downgraded
- **Channel × model cooldown**: a failure cools down only that (channel, model) pair, not every model on the channel
- **Session affinity**: a session (`X-Session-Id`) pins to one credential for better cache hits;
  affinity drops cleanly if it goes unavailable
- **Channel-level circuit break**: when every credential of a channel is out of balance / quota,
  routing **skips the channel proactively** instead of failing after selection
- **Multiple entry modes**: single, bulk paste, merged

### 💰 Billing & accounting

- **Formula**: `quota = (prompt_tokens × prompt_price + completion_tokens × completion_price) / 1,000,000`, plus **per-call pricing**
- **Price rules**: match by model name or **wildcard**, attachable to **groups** and to **specific
  channels** (precedence: channel-specific price → group default price)
- **Cache price split**: cached tokens bill at a separate unit price (falls back to the input price if unset)
- **Quota safety**: reserve + settle + refund; `quota_reservations` uses a unique index on
  `request_id` as an idempotency gate; **unpriced models skip reservation** so free models are
  never blocked by a quota wall
- **Semantics**: `-1` means unlimited; the check is "remaining ≤ 0" rather than "== 0", closing an overdraft hole
- **Price-version snapshot**: every request log records the price rule version it was billed
  against, so **old bills can be recomputed at the old price**
- **Periodic budget**: a token can be capped at "at most N quota per period" (daily / weekly /
  monthly); exceeding it inside a window trips the breaker, and the window resets lazily on expiry
  (no scheduler needed)
- **Payment channels**: manual / Epay / **Stripe** / **Alipay** (RSA2) /
  **WeChat Pay** (APIv3 + platform cert verification + AES-GCM)
- **Order accounting**: callback verification, idempotent crediting, **late-payment recovery**
  (a payment arriving after the order expired is no longer silently dropped), manual fulfilment /
  close (no refund endpoint — refunds are handled privately between the operator and the user)
- **Redeem codes**: bulk generation; redemption is a single atomic transaction (10 concurrent attempts on one code → exactly one wins)

### 🏷️ Groups, pricing and the agent/reseller system

- **Groups are first-class**: display name, billing multiplier, unlock threshold (unlocked once
  cumulative top-ups reach a bar), and a per-minute request limit
- **Admin-only groups**: wholesale / agent tiers are **completely invisible** to ordinary users
  and can only be assigned by an administrator
- **Agent tiers**: a user assigned to an agent group sees **their own tier** in the model plaza,
  rendered as "list price struck through + discounted price", making the discount explicit
- **Plaza price = charged price**: the agent plaza price comes from the exact same price rules as
  billing (one matching implementation), so there is no "looks cheap, charged at list" surprise
- **Group reference counts**: before deleting a group you are told how many channels and price
  rules it affects
- **Public quote endpoint**: `GET /api/models/quote` (no login) returns an estimate from token counts

### 🛠 Operations & console

- **Model plaza**: faceted filters (group / vendor / availability) with **live facet counts**,
  search, sorting, card & list views, detail modal with pricing, effective date, a runnable cURL,
  and a cost calculator
- **Channels**: CRUD, connectivity probes, credential-pool drawer (cooldown countdown, "balance
  exhausted" markers), **one-click model list fetch from upstream**, upstream cost accounting
  (per-token / per-call)
- **Channel health panel**: success rate, cooling-down key count and remaining balance at a glance;
  **auto-disable** unhealthy channels by success rate (thresholds configurable)
- **Cost reconciliation report**: revenue − upstream cost − gross profit − margin by group /
  channel / model; requests without a recorded upstream cost are flagged separately so the report
  is not silently optimistic
- **Retry-ratio alerts**: per discounted group, `r = upstream calls / billed requests`, alerting when
  it crosses the break-even line for that tier
- **Groups**: multiplier, unlock threshold, per-minute request limit (RPM), admin-only toggle
- **Tokens**: quota / expiry / model allowlist / **owning group** / **periodic budget**; plaintext is
  shown exactly once, with an audited "reveal original" recovery entry
- **Users**: registration (optional email code), **email-code login / password reset**, username or
  email + password login, time-limited trial credits with expiry reclamation
- **Referrals & check-in**: invite codes, signup / top-up reward ledger, daily check-in
- **Announcements**: banner + pinned + scheduled on/off
- **Audit log**: key admin actions are recorded and searchable
- **Content safety**: sensitive-word list + master filter toggle (pre-filtering on generation endpoints)
- **Mail**: SMTP configurable in the console with a test send; hot-reloaded
- **Async tasks**: submit, poll, cancel; per-call billing; automatic refunds on failure
- **Also included**: users, redeem codes, orders, request logs, subscription accounts (OAuth), model mappings

### 🔒 Security

- Upstream keys are **AES-256-GCM encrypted at rest**; the master key is env-only (the same-named
  config field is ignored)
- Logs **never print upstream keys** — **not even the query string**, so query-param keys cannot leak
- The admin console supports a **CIDR allowlist** (`AQUA_ADMIN_ALLOW_CIDRS`); anything outside is rejected
- Revealing a token's plaintext goes through a dedicated endpoint that writes an **audit entry**
  (who, when, which token)
- Passwords are salted and hashed; sessions use server-verified signed cookies

### 📜 Compliance notice system

- The terms of service include a "Subscription-account upstream capability" section
- Subscription-account models carry a "for reference / learning" badge in the plaza
- The console shows a **one-time acknowledgement dialog** on first visit (stored in localStorage, reviewable)
- The top-up page shows a short notice before payment
- In code: the subscription-account adapter files are headed with "for learning/reference only;
  production commercial use requires upstream authorisation"

### 🎨 Frontend & themes

- **Three themes**: light / dark / **navy**, switchable at any time and persisted locally; navy
  reuses the dark semantics and overrides colour values
- **Six languages**: 简体中文 / English / Français / Русский / Español / العربية (with RTL layout)
- **Mobile**: bottom navigation, tables degrade to cards, safe-area handling, bottom-sheet modals
- **Componentised**: tables / modals / forms / charts (ECharts) / notices, consistently styled

---

## Supported protocols & upstreams

**Downstream** (how your apps connect): `OpenAI-compatible` · `Anthropic` · `Gemini`

**Upstream** (how we connect out): **79 registered channel types** across 8 categories:

| Category | Description |
|---|---|
| Text LLMs | OpenAI / Azure / Anthropic / Gemini / DeepSeek / Kimi / Zhipu / Qwen / SiliconFlow / OpenRouter / Groq / Together / Mistral / xAI / Ollama / vLLM and more |
| Aggregators | Aggregating relay services |
| Subscription accounts | Claude / Codex / Gemini subscription accounts (OAuth refresh) |
| Self-hosted | Local / private deployments |
| Image | Image-generation upstreams |
| Video | Video-generation upstreams |
| Audio | Speech upstreams |
| Embedding | Embedding upstreams |

> **Straight answer**: of the 79 registered types, **37 already have a finished protocol adapter and
> authentication implementation** (`Available: true`) and are selectable; the rest are shown as
> *"coming soon"* and **cannot be selected** — you will never configure half a channel only to find
> it cannot work. The implemented protocol / auth whitelist is pinned by
> `internal/channeltype/catalog_test.go` to prevent mislabelling.

---

## Tech stack

| Layer | Choice | Notes |
|---|---|---|
| Backend | **Go 1.27** + [Gin](https://github.com/gin-gonic/gin) v1.12 | Single binary, **zero CGO** (SQLite via the pure-Go `modernc.org/sqlite`) |
| Database | **SQLite** | Embedded, zero maintenance; migrations are per-dialect, leaving an extension seam |
| Frontend | **Next.js 16.3** (static export) + **React 19** + **Tailwind CSS v4** + TypeScript 5 | Build output `web/dist` is embedded via `go:embed` |
| Charts | ECharts 5 | Console statistics |

> The frontend uses `output: 'export'` (static). There is **no separate frontend host**: the UI and
> the API share one origin and one port, so deployment is a single binary.

---

## Full request lifecycle

What a `/v1/chat/completions` call goes through inside the gateway (useful for debugging and for
extending it):

```
Client
  │  ① Auth & rate limiting
  ├─▶ TokenAuth        validate token (enabled / expiry / model allowlist / owning group)
  │                    reserve quota (step one of reserve → settle → refund)
  ├─▶ Group RPM gate   per-group per-minute request cap (zero cost when rpm_limit = 0)
  ├─▶ Sensitive-word pre-filter
  │
  │  ② Routing
  ├─▶ filter usable channels by group (enabled + model support + time rules)
  ├─▶ channel circuit check  are all credentials out of balance / quota? → skip
  ├─▶ pick a credential       failure cooldown + channel×model cooldown + affinity + five strategies
  │
  │  ③ Forwarding & adaptation
  ├─▶ inbound protocol → canonical OpenAI form → upstream adapter (by channel type)
  ├─▶ bidirectional streaming conversion (frame-level SSE)
  ├─▶ classified handling: 429 → rotate key; 5xx → switch channel; filter → switch model; empty 200 → downgrade
  │
  │  ④ Response & accounting
  ├─▶ inject observable headers (X-Routed-Via / X-Fallback-Attempts / X-Upstream)
  ├─▶ settle quota (refund the difference on success; full refund on failure)
  ├─▶ write the request log (real channel / upstream model / price-version snapshot)
  └─▶ update credential runtime state (last used / cooldown / failure count / balance)
```

---

## 🚀 Quick start

### Option 1 — Docker Compose (recommended)

```bash
git clone https://gitee.com/xiaosu4610/AQUA-API.git && cd AQUA-API
cp .env.example .env

docker build -t aqua-api:local .          # first build (frontend + backend + runtime image)
docker run --rm aqua-api:local -gen-key   # prints a master key → put it in .env as AQUA_APP_KEY

docker compose up -d
```

Open `http://127.0.0.1:8787`. Data lives in `./data` on the host — moving servers is a directory copy.

### Option 2 — docker run

```bash
docker build -t aqua-api:local .

docker run -d --name aqua-api \
  -p 8787:8787 \
  -e AQUA_APP_KEY="<your master key>" \
  -e AQUA_SERVER_LISTEN=0.0.0.0:8787 \
  -v "$PWD/data:/data" \
  --restart unless-stopped \
  aqua-api:local
```

### Option 3 — Single binary (Linux / systemd)

```bash
go build -o aqua ./cmd/aqua           # pure Go, zero CGO, no gcc needed
./aqua -gen-key                        # generate the encryption master key

sudo useradd -r -s /usr/sbin/nologin aqua
sudo mkdir -p /opt/aqua /etc/aqua /var/lib/aqua
sudo cp aqua /opt/aqua/aqua && sudo chown aqua:aqua /opt/aqua/aqua

sudo cp .env /etc/aqua/aqua.env        # fill in real secrets
sudo chmod 600 /etc/aqua/aqua.env && sudo chown root:root /etc/aqua/aqua.env

sudo cp aqua-api.service /etc/systemd/system/
sudo systemctl daemon-reload && sudo systemctl enable --now aqua-api
```

**Upgrading**: replace `/opt/aqua/aqua` and `sudo systemctl restart aqua-api`
(migrations run automatically on startup).

> Keep the previous binary (e.g. `aqua.bak-<timestamp>`). Rolling back is a `cp` plus a restart;
> migrations only **add** columns, never drop them, so they are forward-compatible.

### Option 4 — From source (development)

```bash
cd web && npm ci && npm run build && cd ..   # optional: repo ships a placeholder web/dist

go build -o bin/aqua ./cmd/aqua
export AQUA_APP_KEY="<your master key>"
./bin/aqua -config ./aqua.json
curl http://127.0.0.1:8787/healthz
```

> **The frontend is embedded** via `go:embed`, so **deployment is a single file**.
> Building without running the frontend build leaves a placeholder page — the API still works.

### First run (install wizard)

Opening the site for the first time leads into the **install wizard**: create the super-admin
account → fill in site details → (optional) configure payment / mail. You can also sign in to the
admin panel from its own dedicated entry.

### Reverse proxy

Put Nginx or Caddy in front for HTTPS. Two things that bite people:

```nginx
location / {
    proxy_pass http://127.0.0.1:8787;
    proxy_http_version 1.1;

    # 1) Streaming must not be buffered, or the UI waits for the whole answer
    proxy_buffering off;
    proxy_cache off;

    # 2) Must exceed the gateway's upstream timeout (300s), or long answers get cut
    proxy_read_timeout 600s;
    proxy_send_timeout 600s;

    proxy_set_header Host $host;
    proxy_set_header X-Real-IP $remote_addr;
    proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
    proxy_set_header X-Forwarded-Proto $scheme;
}
```

> Behind Cloudflare's orange-cloud proxy, origin fetches are hard-capped at **100 seconds**
> (you'll see 524s). To use the full 300-second timeout, add a **DNS-only (grey cloud)** record.

---

## Configuration

Priority: **defaults < config file < environment variables**.

| Variable | Required | Notes |
|---|---|---|
| `AQUA_APP_KEY` | ✅ | Encryption master key, **env only** (config field ignored). Generate with `aqua -gen-key` |
| `AQUA_SERVER_LISTEN` | | Default `127.0.0.1:8787`; must be `0.0.0.0:8787` inside containers |
| `AQUA_SERVER_MODE` | | `debug` / `release` / `test` |
| `AQUA_DATABASE_DRIVER` / `AQUA_DATABASE_DSN` | | `sqlite`, default `./data/aqua.db` |
| `AQUA_RELAY_GROUP` | | Gateway **default group** (where group-less tokens resolve), default `default` |
| `AQUA_ADMIN_ALLOW_CIDRS` | | Admin console **allowlist** (comma-separated CIDRs, e.g. `10.0.0.0/8,1.2.3.4/32`). Empty = unrestricted |
| `AQUA_CHANNEL_AUTO_DISABLE_MIN_REQUESTS` | | Minimum sample size for auto-disable (0 = disabled, the default) |
| `AQUA_CHANNEL_AUTO_DISABLE_SUCCESS_RATE` | | Success-rate floor (e.g. `0.9`); below it (with enough samples) the channel is disabled |
| `AQUA_CHANNEL_AUTO_DISABLE_WINDOW_MINUTES` | | Statistics window in minutes |
| `AQUA_SMTP_HOST` / `AQUA_SMTP_PORT` / `AQUA_SMTP_USERNAME` / `AQUA_SMTP_PASSWORD` / `AQUA_SMTP_FROM` / `AQUA_SMTP_FROM_NAME` | | Outbound mail (signup codes, notifications); also configurable in the console |
| `AQUA_EPAY_KEY` | | Epay merchant key (MD5 signature) |
| `AQUA_STRIPE_SECRET_KEY` / `AQUA_STRIPE_WEBHOOK_SECRET` | | Stripe |
| `AQUA_ALIPAY_PRIVATE_KEY` / `AQUA_ALIPAY_PUBLIC_KEY` | | Official Alipay (RSA2) |
| `AQUA_WECHATPAY_APIV3_KEY` / `AQUA_WECHATPAY_PRIVATE_KEY` / `AQUA_WECHATPAY_PLATFORM_PUBLIC_KEY` | | Official WeChat Pay (APIv3) |
| `AQUA_LOG_LEVEL` / `AQUA_LOG_FORMAT` | | `debug`/`info`/`warn`/`error`, `text`/`json` |

Full sample: [`.env.example`](.env.example).

### Config file

```json
{
  "server":   { "listen": "127.0.0.1:8787", "mode": "release" },
  "database": { "driver": "sqlite", "dsn": "./data/aqua.db" },
  "log":      { "level": "info", "format": "text" }
}
```

### Two security rules

1. **Secrets never enter the database.** Payment, SMTP and the master key are env-only;
   only operational parameters (gateway URL, merchant ID, FX rate, limits, toggles) live in
   the database and are editable in the console. Even a full database dump yields no usable credential.
2. **Back up the master key separately.** Change it and every stored upstream key becomes
   undecryptable — you would have to re-enter them all.

---

## Client integration

Any OpenAI-compatible client works: point the Base URL at AQUA-API and use an AQUA-API token as the key.

### curl

```bash
curl https://your-domain/v1/chat/completions \
  -H "Authorization: Bearer sk-your-token" \
  -H "Content-Type: application/json" \
  -d '{
    "model": "your-model",
    "messages": [{"role": "user", "content": "hello"}],
    "stream": true
  }'
```

### OpenAI SDK (Python)

```python
from openai import OpenAI

client = OpenAI(base_url="https://your-domain/v1", api_key="sk-your-token")
resp = client.chat.completions.create(
    model="your-model",
    messages=[{"role": "user", "content": "hello"}],
)
print(resp.choices[0].message.content)
```

### Claude Code / Anthropic clients

AQUA-API speaks Anthropic natively, so it can take over Claude Code traffic directly:

```bash
export ANTHROPIC_BASE_URL=https://your-domain
export ANTHROPIC_AUTH_TOKEN=sk-your-token
claude
```

### Other clients

Cursor, Codex CLI, Cherry Studio, NextChat, LobeChat and similar: choose
"OpenAI-compatible / custom OpenAI endpoint" and paste the Base URL and token.

### Estimate cost (no token needed)

```bash
curl "https://your-domain/api/models/quote?model=your-model&prompt_tokens=1000&completion_tokens=500"
```

---

## Operations guide (groups · agents · billing)

### How groups and channels relate

- A **channel** decides *whether* a request may use that upstream (which models it claims, which
  groups it belongs to);
- A **credential** (each key under a channel) decides *which key* is used, and can further restrict
  the groups / models it serves;
- A **token** may name its group; otherwise it falls into the **gateway default group**
  (`AQUA_RELAY_GROUP`).

> ⚠️ **The most common trap**: after moving channels to a new group, if you forget to update the
> default group, every group-less token immediately reports "no available channel".

### Configuring an agent/reseller tier

1. In **Groups** create an agent tier (e.g. `agent`), set the **billing multiplier** to the wholesale
   discount (e.g. `60` = 60%), and enable **admin-only**;
2. In **Prices** configure pricing for that tier (it can differ from the public tier), or reuse the
   same rules and let the multiplier discount them;
3. In **Users** assign the reseller account's `agent_group` to that tier;
4. The agent now sees **their tier** in the model plaza, with "list price struck through +
   discounted price", and it matches what is actually charged.

### Price precedence

```
channel-specific price (channel_id = that channel)   ← highest
        ↓ if absent, fall back to
group default price (channel_id = 0)
```

The same model and group can be priced differently per channel, for cases where different upstreams
have different costs.

### Quota and budget

- **Total quota**: at both token and user level; `-1` means unlimited;
- **Periodic budget**: set "at most N per period" on a token, with daily / weekly / monthly windows;
  exceeding it returns 429 and the window resets automatically on expiry.

### Cost and margin

The console's **cost reconciliation** aggregates by group / channel / model:

```
gross profit = revenue (quota actually charged to users) − upstream cost (per the channel cost rules)
```

Enter upstream cost per channel either per-token or per-call; **requests with no recorded cost are
flagged separately** so you remember to fill them in — otherwise that cost is counted as zero and
the report looks rosier than reality.

---

## FAQ

**`/healthz` returns 503?**
That means the database is unreachable. Check the log for the database error; with SQLite,
verify permissions on the data directory first.

**Why can't I see upstream keys in plaintext in the console?**
By design. Keys are AES-256-GCM encrypted at rest and shown masked — a compromised console
cannot export usable credentials. To rotate one, just overwrite it.

**After moving a channel to a new group, every token says "no available channel".**
The most common trap. The gateway has a **default group** (`AQUA_RELAY_GROUP`) that decides
where group-less tokens look for channels. After moving channels you must update it and
restart, or existing tokens lose their route instantly.

**Why is a free model still blocked by quota?**
Models with no matching price rule **skip reservation** and should not be blocked. If one is,
check whether the group has a **wildcard price rule** (e.g. `*`) — that makes the model "priced".

**Frequent upstream 429s / timeouts?**
429 is a **credential-level** failure: the gateway rotates to another key and puts that key
into a short cooldown (exponential backoff, auto-recovery). If it happens a lot, you likely
have too few keys or a low per-key limit — add keys or lower the per-minute cap.

**A user hit a 429 because of the group's per-minute cap.**
The response carries `error.code = quota.group_rpm_exceeded` and states the group's per-minute
limit. Raise the limit or move the user to an uncapped group.

**An agent says "I see the discount but I'm charged list price".**
Normally impossible: the agent plaza price and billing come from the same price rules. Check
① the agent account's `agent_group` is indeed that tier, and
② the agent's **token was created with that group selected** (a token without the right group
falls back to the default tier). If both are correct and it still mismatches, please open an issue.

**How do I back up?**
Stop the service (or use `VACUUM INTO` for a hot copy) → copy `aqua.db` → **and back up
`AQUA_APP_KEY`**. Without the master key the upstream keys in that backup are undecryptable bytes.

**MySQL / PostgreSQL support?**
SQLite only today, which covers self-hosting and small-to-medium scale. The storage layer
already has a dialect seam (per-dialect migration directories, a driver registry with field
metadata) so adding one later does not require rewriting the business layer.

**How do I add a new upstream type?**
Register its metadata in `internal/channeltype/catalog.go` (default base URL, auth mode, extra
required parameters, path template, capability flags) and confirm it against the implemented
whitelist in `catalog_test.go`. If it belongs to an existing protocol family
(OpenAI-compatible), that is all. A different protocol needs an adapter in `internal/relay/`.

**Why don't I see my upstream key in the logs?**
Also by design: logs print whether credentials were injected plus the upstream host and path —
**not even the query string**, so query-param keys cannot leak.

**How do I see which channel handled a request, and how many fallbacks it took?**
The response carries `X-Routed-Via` / `X-Fallback-Attempts` / `X-Upstream`; the request log also
records the real channel and upstream model name.

---

## Roadmap

- [x] Protocol conversion (OpenAI ↔ Anthropic ↔ Gemini) with bidirectional streaming and tool calls
- [x] Five credential scheduling strategies, cooldown/half-open, session affinity, in-flight counting
- [x] Reserve / settle / refund quota system; incremental streaming usage parsing
- [x] Groups & multipliers, model plaza, redeem codes, five payment channels, async tasks
- [x] Single-binary + Docker deployment with an embedded frontend
- [x] Browser install wizard + dedicated admin entry; admin audit log; announcements
- [x] Email-code login / password reset; referrals & check-in; time-limited trial credits
- [x] Failure-classified retries, channel × model cooldown, upstream `Retry-After`
- [x] Token rolling-window budgets (daily / weekly / monthly)
- [x] Per-group per-minute request plans (RPM), channel-level balance circuit break
- [x] Agent tiers with plaza discount display, public quote endpoint
- [x] True-cost reconciliation (revenue − cost − gross profit), price-version snapshots
- [x] Channel health panel & auto-disable by success rate, admin CIDR allowlist
- [x] Three themes (light / dark / navy), site-wide compliance notices
- [ ] AWS Bedrock / Google Vertex signature auth
- [ ] Image / video / audio upstream adapters (registered; adapters pending)
- [ ] UI for per-channel price entry (backend capability is ready)
- [ ] Subscription quota-window visualisation (auto-reset every 5h / day / week)

---

## Development

```bash
go build ./...       # build
go test ./...        # test
gofmt -w .           # format

cd web && npm ci && npm run type-check && npm run build   # frontend
```

Layout (this repository *is* the code directory):

```
cmd/aqua/              entrypoint (wiring only)
internal/config/       config loading & validation
internal/model/        domain models & repository interfaces
internal/store/        persistence (SQL + versioned migrations, per dialect)
internal/server/       HTTP layer (routing / middleware / handlers)
internal/relay/        protocol adaptation & forwarding (routing / billing / cooldown)
internal/payment/      payment channel adapters
internal/channeltype/  channel type registry (79 types)
internal/i18n/         server-side localisation
web/                   frontend (Next.js; build output embedded into the binary)
Dockerfile             multi-stage: frontend → backend → minimal runtime
aqua-api.service       systemd unit for bare-metal deployment
```

### Mandatory conventions

1. **Small commits** — commit each independently describable step immediately; every commit
   should be buildable and revertible. The full commit timeline is the project's provenance record;
   squashing is not allowed.
2. **Structured comments** — every source file starts with an **Intent / Flow / Extension** header
   describing what the code does, how data flows and where to extend it; technical reasons only,
   no personal notes.
3. **Secrets never in the database, on disk, or in logs.**
4. **Originality red line** — reading, studying and learning from any public project (including
   reference implementations) to understand features and algorithms is allowed; **verbatim copying**
   of code, comments, constant tables or naming conventions is not. The test is simple: can you
   explain this implementation's design trade-offs without the reference project?

See [`AGENTS.md`](AGENTS.md) (Chinese) and [`CONTRIBUTING.md`](CONTRIBUTING.md).

---

## Contributing

- **The `main` branch is protected**; only maintainers push to it. External changes go through
  **Fork + Pull Request**.
- Create as many `feature/*` / `fix/*` branches as you like in your own fork;
  open a PR to merge back into this repository (merged without squash, preserving your timeline).
- Commit conventions, verification checklist and issue/PR templates:
  [**CONTRIBUTING.md**](CONTRIBUTING.md).

---

## License

Source code is licensed under the [**Mulan Public License, Version 2 (Mulan PSL v2)**](LICENSE)
(Chinese text authoritative; official reference: http://license.coscl.org.cn/MulanPSL2).

> Under its terms you may freely copy, use, modify and redistribute this software,
> **including commercially**, provided you retain the license text and the copyright,
> trademark, patent and disclaimer notices. No trademark rights are granted.

Companion documents:

| File | Purpose |
|---|---|
| [LICENSE](LICENSE) | Full license text (Mulan PSL v2) |
| [DISCLAIMER.md](DISCLAIMER.md) | Usage notice and disclaimer |
| [TRADEMARK.md](TRADEMARK.md) | Brand and trademark statement |
| [NOTICE](NOTICE) | Copyright, originality record and redistribution duties |
| [CONTRIBUTING.md](CONTRIBUTING.md) | Contribution guide (Fork + PR workflow) |
| [AGENTS.md](AGENTS.md) | Code guide (Chinese, for AI assistants and developers) |

---

<div align="center">

**If this saved you an afternoon of reconciling invoices, a star is appreciated ⭐**

[🌐 Live demo](https://aqua.is3.cc) ｜ [🐛 Issues](https://gitee.com/xiaosu4610/AQUA-API/issues) ｜ [🌍 GitHub](https://github.com/xiaosu4610/AQUA-API) ｜ [📖 简体中文](README.md)

</div>
