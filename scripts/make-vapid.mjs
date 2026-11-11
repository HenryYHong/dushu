// Makes the sync server's Web Push key pair (VAPID, RFC 8292) and writes only its JSON to stdout, the form the Worker's
// VAPID_KEYS secret takes (cloud/src/push.ts vapidKeys): {"publicKey": "<base64url of the 65-byte P-256 point>",
// "privateKey": "<base64url of the 32-byte private scalar>"}. Piped straight into the secret, so the key is never shown or saved:
//
//   cd cloud && node ../scripts/make-vapid.mjs | npx wrangler secret put VAPID_KEYS
//
// Every browser that turns reminders on subscribes with the public half. A new pair makes those subscriptions useless (their
// push services refuse messages signed with another key), so make one once and keep it; each device turns reminders on again
// after a change.
const pair = await crypto.subtle.generateKey({ name: 'ECDSA', namedCurve: 'P-256' }, true, ['sign', 'verify']);
const publicKey = Buffer.from(await crypto.subtle.exportKey('raw', pair.publicKey)).toString('base64url');
const { d } = await crypto.subtle.exportKey('jwk', pair.privateKey);
process.stdout.write(JSON.stringify({ publicKey, privateKey: d }));
