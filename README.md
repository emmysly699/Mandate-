Mandate

A trust layer between AI shopping agents and PayPal. Users set spending rules
(a "mandate"); every agent purchase is checked against it before PayPal moves
money, and every step is recorded so disputes can be answered with evidence.
Built for the PayPal AI Hackathon.
Status

Day 1: PayPal sandbox spike (create order, buyer approval, capture).
Run locally
Bash
Deploy on Render
Build command: npm install
Start command: npm start
Environment variables: PAYPAL_CLIENT_ID, PAYPAL_CLIENT_SECRET, BASE_URL
Test the sandbox flow
/paypal/token-check confirms credentials work.
/paypal/create?amount=10 sends you to PayPal; log in with a sandbox buyer account.
After approving, you land on /paypal/return, which captures the payment.
Sandbox only. No real money is used.
License
MIT