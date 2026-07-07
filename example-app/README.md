# Example app — Amplitude server-side GTM template

A minimal setup for testing this repo's Amplitude tag template locally:

- **`docker-compose.yml`** — runs Google's official server-side GTM image as a
  tagging server on `localhost:8080` and a debug/preview server on
  `localhost:8081` (both loaded with container `GTM-XXXXXXX`), plus a small
  Caddy sidecar (`preview-tls`) that TLS-fronts the preview server so the
  tagging server can forward preview hits to it.
- `**index.html` / `server.js**` — a one-page app on `https://localhost:3000`
with buttons that fire GA4-format hits (`page_view`, `sign_up`, `purchase`,
`button_click`) at the tagging server's `/g/collect` endpoint. The GA4 client
in the container claims them and hands the event data to the Amplitude tag.
The same server also proxies Tag Assistant's debug traffic (see the preview
section below).

## How server-side GTM works (vs client-side)

In **client-side GTM** the container runs in the browser and each vendor tag
calls that vendor's JS SDK, so the browser talks to every vendor directly. In
**server-side GTM** the browser sends **one** stream of events to a container
running on a server you host, and tags there fan events out to vendors via
plain server-to-server HTTP calls — no SDKs involved.

```
┌────── Browser ──────┐        ┌───── Your server (the Docker container, :8080) ─────┐
│                     │        │        sGTM container  GTM-XXXXXXX                   │
│  user clicks        │        │                                                      │
│    │                │  one   │  ① CLIENT (new concept — no equivalent in web GTM)   │
│    ▼                │  HTTP  │     The GA4 Client listens for /g/collect requests,  │
│  gtag.js  ──────────┼───────►│     "claims" them, parses the raw hit into a clean   │
│  (GA4 format hit)   │  hit   │     Event Data object (event_name, client_id, …)     │
│                     │        │        │                                             │
└─────────────────────┘        │        ▼                                             │
                               │  ② TRIGGER fires        (same idea as web GTM)       │
                               │        │                                             │
                               │        ▼                                             │
                               │  ③ TAG: Amplitude template (this repo)               │
                               │     source.js reads Event Data, builds a JSON        │
                               │     payload, and POSTs it server-to-server ──────────┼──► api2.amplitude.com/2/httpapi
                               └──────────────────────────────────────────────────────┘
```

Two things are genuinely new compared to web GTM:

1. **Clients.** A server has no dataLayer — it only receives raw HTTP
  requests. A *Client* is the adapter that recognizes an incoming request
   format ("this is a GA4 hit") and converts it into the Event Data object
   that triggers and tags consume. That's why this app's hits are GA4-shaped:
   so the built-in GA4 Client claims them.
2. **Tags make HTTP calls, not SDK calls.** There is no Amplitude SDK on the
  server. This repo's `source.js` *is* the tag: it pulls `event_name`,
   `client_id`, `user_id` etc. out of Event Data and calls `sendHttpRequest`
   against Amplitude's HTTP V2 API. The template replaces the SDK.

### How this example app maps onto that

```
index.html (localhost:3000)          server.js              Docker "tagging" (:8080)
┌─────────────────────────┐      ┌──────────────┐      ┌───────────────────────────┐
│ button click            │      │ proxy        │      │ GA4 Client claims hit     │
│  └► fetch('/g/collect   │ ───► │ /g/collect ─►│ ───► │  └► Event Data            │
│      ?en=sign_up        │      │ (CORS dodge  │      │      └► trigger           │
│      &cid=…&uid=…')     │      │  only)       │      │          └► Amplitude tag ─┼──► Amplitude
└─────────────────────────┘      └──────────────┘      └───────────────────────────┘
     plays the role of                plumbing               plays the role of
     gtag.js on a real site                                  your deployed sGTM server
```

- `index.html` fakes what `gtag.js` does on a real site: build a GA4-format
hit (`en=` event name, `cid=` client id, `uid=` user id) and send it. On a
production site you'd configure gtag.js with `server_container_url`
pointing at your sGTM domain and it does this for you.
- `server.js` is not part of the GTM story at all — it terminates TLS (mkcert
cert in `certs/`), proxies `/g/collect` because browsers block the
cross-origin call (`/g/collect` responses carry no CORS headers), and
proxies `/gtm/*` so Tag Assistant preview works (next section).
- The Docker `tagging` container is a real sGTM server, loaded with container
`GTM-XXXXXXX`, running whatever Clients/triggers/tags that container
version configures — including the Amplitude tag built from this template.

The analogy to hold onto: **trigger → tag is identical to web GTM; the "SDK
call" is replaced by a server-side HTTP request the template constructs; and
Clients are the new front door that turns raw HTTP traffic into events.**

### How preview (Tag Assistant) works locally

Preview involves a second sGTM server: the **preview server** runs your
*draft workspace* in debug mode and streams results to Tag Assistant, while
the tagging server keeps serving the *published* version. Two constraints
shape the local setup:

1. The GTM UI's **Preview** button opens `{server URL}/gtm/debug?…` — and this
  container's server URL is set to `https://localhost:3000`. So our app
   server must answer `/gtm/`* over HTTPS and hand it to the preview server.
2. Hits are *never* sent to the preview server directly (it 404s them).
  Instead the **tagging server** inspects every hit: if it carries an
   `X-Gtm-Server-Preview` header, it forwards the hit to its configured
   `PREVIEW_SERVER_URL` — which the image insists must be `https://`. The
   preview container only speaks plain HTTP, hence the Caddy TLS sidecar.

```
┌───────────────────────────── Browser ─────────────────────────────┐
│  Tag Assistant tab                 example app page               │
│  (opened by GTM UI “Preview”,      (paste the preview token from  │
│   loads /gtm/debug?…)               ⋮ → “Send requests manually”) │
└──────┬──────────────────────────────────┬─────────────────────────┘
       │ /gtm/*                           │ /g/collect
       │                                  │ (+ X-Gtm-Server-Preview header
       ▼                                  ▼  when the token box is filled)
┌── server.js — https://localhost:3000 (mkcert TLS) ────────────────┐
│      /gtm/* ──────────────────┐        /g/collect ────────┐       │
└───────────────────────────────┼───────────────────────────┼───────┘
                                │                           ▼
                                │        ┌─ tagging server (:8080) ──────────────┐
                                │        │ runs the PUBLISHED container version  │
                                │        │                                       │
                                │        │ no preview header:                    │
                                │        │   process here ──► api2.amplitude.com │
                                │        │                                       │
                                │        │ preview header present:               │
                                │        │   forward hit to PREVIEW_SERVER_URL ──┼──┐
                                │        └───────────────────────────────────────┘  │
                                │                                                   │
                                │            ┌─ preview-tls (Caddy, https──►http) ◄─┘
                                │            └──────────────┬──────────────────────
                                ▼                           ▼
                       ┌─ preview server (:8081) ─────────────────────────────────┐
                       │ runs your DRAFT workspace in debug mode:                 │
                       │  • executes the hit (clients → triggers → tags,          │
                       │    real outbound calls included ──► api2.amplitude.com)  │
                       │  • streams what happened back to the Tag Assistant tab   │
                       └──────────────────────────────────────────────────────────┘
```

So a hit with the token exercises your **draft** (that's why an unpublished
Amplitude tag shows up in preview), and a hit without it exercises the
**published** version — if the two behave differently, you haven't published.

## Run it

```sh
cd example-app

# 0. One-time: generate the local TLS cert. The certs/ directory is
#    gitignored — every machine generates its own.
#    Install mkcert first if needed: brew install mkcert && mkcert -install
mkdir -p certs

# 1. One-time: point the stack at YOUR server GTM container. Copy the
#    example env file and set CONTAINER_CONFIG (the base64 string from the
#    GTM UI's manual provisioning instructions). .env is gitignored.
cp .env.example .env

# 2. Start the sGTM servers (Docker must be running)
docker compose up -d

# 3. Start the example app
node server.js

# 4. Open https://localhost:3000 and click the buttons   (note: httpS)
```

## Debugging in Tag Assistant

Requires the container's server URL (GTM UI → Admin → Container Settings) to
be `https://localhost:3000`.

1. In the GTM UI for `GTM-XXXXXXX`, click **Preview** — Tag Assistant loads
   via the `/gtm/debug` proxy.
2. In Tag Assistant, open **⋮ → Send requests manually** and copy the
   `X-Gtm-Server-Preview` header value.
3. Paste it into the "Preview token" box on `https://localhost:3000` and click
   the event buttons — each hit appears in Tag Assistant, showing the claiming
   client, matched triggers, and the tag's outgoing request/response to
   Amplitude.

Tokens are session-bound: if you reopen Tag Assistant, copy a fresh one. To
watch raw traffic instead: `docker compose logs -f tagging`.

## Notes

- `CONTAINER_CONFIG` (set in `.env`, read by the compose file) decodes to
`id=GTM-XXXXXXX&env=1&auth=…` — it pins the servers to your container
environment. It contains an auth token, which is why `.env` is gitignored.
- For a real deployment, run the same image on an approved cloud (GCP Cloud
Run / App Engine, AWS, or Azure) per Google's sGTM provisioning docs.

