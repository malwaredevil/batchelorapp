import { createHmac } from "node:crypto";

const BASE = `https://${process.env.REPLIT_DEV_DOMAIN}`;
const secret = process.env.RESEND_WEBHOOK_SECRET_DEV;
const secretBytes = Buffer.from(secret.slice("whsec_".length), "base64"); // strip "whsec_" (6 chars)

const svixId = `msg_test_gmail_${Date.now()}`;
const svixTs = Math.floor(Date.now() / 1000).toString();

const body = JSON.stringify({
  type: "email.received",
  data: {
    email_id: "test-email-001",
    from: "Jonathan Batchelor <batchelorjc@gmail.com>",
    to: "elaine@app.batchelor.app",
    subject: "Fwd: Your booking confirmation - Flight AA1234 STL to ORD",
    text: [
      "---------- Forwarded message ---------",
      "From: American Airlines <confirmations@aa.com>",
      "Date: Sat, Jul 19, 2026",
      "Subject: Your booking confirmation",
      "",
      "Dear Jonathan,",
      "",
      "Your booking is confirmed.",
      "",
      "Flight: AA 1234",
      "Departure: St. Louis (STL) - July 25, 2026 at 8:45 AM",
      "Arrival: Chicago O'Hare (ORD) - July 25, 2026 at 10:05 AM",
      "Confirmation: ABCD12",
      "Passenger: Jonathan Batchelor",
      "",
      "Return Flight: AA 5678",
      "Departure: Chicago O'Hare (ORD) - July 28, 2026 at 6:30 PM",
      "Arrival: St. Louis (STL) - July 28, 2026 at 7:45 PM",
      "",
      "Thank you for flying with American Airlines.",
    ].join("\n"),
    html: null,
    attachments: [],
  },
});

const msg = `${svixId}.${svixTs}.${body}`;
const sig = createHmac("sha256", secretBytes).update(msg).digest("base64");
const signature = `v1,${sig}`;

console.log("svix-id:", svixId);
console.log("svix-timestamp:", svixTs);
console.log("signature preview:", signature.slice(0, 30) + "...");
console.log("");

const resp = await fetch(`${BASE}/api/elaine/email-webhook`, {
  method: "POST",
  headers: {
    "Content-Type": "application/json",
    "svix-id": svixId,
    "svix-timestamp": svixTs,
    "svix-signature": signature,
  },
  body,
});

const text = await resp.text();
console.log(`HTTP ${resp.status}: ${text}`);
