# Mandate

A trust layer between AI shopping agents and PayPal. You set spending rules (a "mandate").
Every purchase an agent wants to make is checked against it before PayPal moves any money,
and every step is written to a tamper-evident ledger so disputes can be answered with evidence.

Built for the PayPal AI Hackathon.

## How it works
1. **Agent** (Gemini) reads your request and picks an item from a mock shop.
2. **Policy engine** (plain code, no AI) checks category, per-purchase cap, monthly budget and approval threshold.
3. **AI reviewer** (Gemini) checks the purchase against your stated intent and can escalate to a human.
4. **Decision:** approved, needs your OK, or blocked.
5. **PayPal sandbox:** approved purchases create a PayPal order; you confirm it with PayPal and the payment is captured.
6. **Evidence ledger:** each step is stored in a hash-chained log. Changing any entry breaks the chain.

If the AI is unavailable or rate-limited, the agent and reviewer fall back to simple logic so the rules still run.

## Environment variables
| Name | Required | Purpose |
|---|---|---|
| `PAYPAL_CLIENT_ID` | yes | PayPal sandbox app Client ID |
| `PAYPAL_CLIENT_SECRET` | yes | PayPal sandbox app Secret |
| `BASE_URL` | yes | Public URL of the app, no trailing slash |
| `GEMINI_API_KEY` | recommended | Google AI Studio key |
| `GEMINI_MODEL` | optional | Default `gemini-2.5-flash` |
| `GEMINI_FALLBACK_MODEL` | optional | Default `gemini-2.5-flash-lite` |

## Run locally
```bash
npm install
PAYPAL_CLIENT_ID=... PAYPAL_CLIENT_SECRET=... BASE_URL=http://localhost:3000 GEMINI_API_KEY=... npm start
```

## Deploy on Render
- Build command: `npm install`
- Start command: `npm start`
- Add the environment variables above.

## Useful URLs
- `/` dashboard
- `/health` configuration status
- `/paypal/token-check` confirms PayPal sandbox credentials
- `/api/ledger` full evidence ledger

Sandbox only. No real money is used. Demo state is in memory and resets when the server restarts.

## AI tools used
Google Gemini (agent and intent reviewer). Claude was used as a coding assistant.

## License
MIT
