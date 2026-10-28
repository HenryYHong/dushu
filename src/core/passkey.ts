// Passkeys for the sync account (cloud/src/worker.ts): Face ID, Touch ID or the device's PIN instead of an emailed code, so
// signing in costs nothing and has no daily limit. Someone the owner invites makes an account with a passkey on the invite
// link (no email at all); anyone signed in can add a passkey for the next device. The browser's own WebAuthn does the work:
// this module only turns the server's options into what navigator.credentials takes, and the passkey's answer back into JSON.
import { CLOUD_EVENT, cloudBase, cloudSession, keepSession, post, type CloudSession } from './cloud';

/** Whether this browser can make and use passkeys. */
export function passkeysSupported(): boolean {
  return typeof window !== 'undefined' && typeof window.PublicKeyCredential === 'function' && !!navigator.credentials;
}

const fromB64url = (s: string): ArrayBuffer => {
  const b = atob(s.replace(/-/g, '+').replace(/_/g, '/') + '='.repeat((4 - (s.length % 4)) % 4));
  const out = new Uint8Array(b.length);
  for (let i = 0; i < b.length; i++) out[i] = b.charCodeAt(i);
  return out.buffer;
};
const toB64url = (buf: ArrayBuffer | ArrayBufferView): string => {
  const bytes = buf instanceof ArrayBuffer ? new Uint8Array(buf) : new Uint8Array(buf.buffer, buf.byteOffset, buf.byteLength);
  let s = '';
  for (const b of bytes) s += String.fromCharCode(b);
  return btoa(s).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
};

interface CreationJSON {
  challenge: string; timeout: number; attestation: AttestationConveyancePreference;
  rp: { id: string; name: string }; user: { id: string; name: string; displayName: string };
  pubKeyCredParams: PublicKeyCredentialParameters[]; authenticatorSelection: AuthenticatorSelectionCriteria;
  excludeCredentials: { type: 'public-key'; id: string }[];
}
interface RequestJSON { challenge: string; rpId: string; timeout: number; userVerification: UserVerificationRequirement }

/** Turns the browser's refusals into words: a passkey the person closed, or one this browser cannot make. */
function why(e: unknown): Error {
  const name = (e as { name?: string })?.name;
  if (name === 'NotAllowedError' || name === 'AbortError') return new Error('The passkey was not used. Try again when you’re ready.');
  if (name === 'InvalidStateError') return new Error('This device already has a passkey for this account.');
  if (name === 'SecurityError') return new Error('Passkeys work only on Dushu’s own address.');
  return e instanceof Error ? e : new Error('The passkey did not work. Try again.');
}

/** Makes a passkey from the server's options, and gives back its answer as the server reads it (RegistrationResponseJSON). */
async function create(o: CreationJSON): Promise<unknown> {
  let cred: PublicKeyCredential | null;
  try {
    cred = await navigator.credentials.create({ publicKey: {
      challenge: fromB64url(o.challenge), timeout: o.timeout, attestation: o.attestation,
      rp: o.rp, user: { ...o.user, id: fromB64url(o.user.id) },
      pubKeyCredParams: o.pubKeyCredParams, authenticatorSelection: o.authenticatorSelection,
      excludeCredentials: o.excludeCredentials.map((c) => ({ type: c.type, id: fromB64url(c.id) })),
    } }) as PublicKeyCredential | null;
  } catch (e) { throw why(e); }
  if (!cred) throw why(null);
  const r = cred.response as AuthenticatorAttestationResponse;
  return {
    id: cred.id, rawId: toB64url(cred.rawId), type: cred.type,
    response: { clientDataJSON: toB64url(r.clientDataJSON), attestationObject: toB64url(r.attestationObject), transports: r.getTransports?.() ?? [] },
    clientExtensionResults: cred.getClientExtensionResults?.() ?? {},
    ...(cred.authenticatorAttachment ? { authenticatorAttachment: cred.authenticatorAttachment } : {}),
  };
}

/** Whose an invite link is (what the owner called it), or an error when it is no good anymore. */
export async function inviteLabel(invite: string): Promise<string> {
  const data = await (await post('/auth/invite', { invite })).json() as { label?: string };
  return data.label ?? '';
}

/** Makes an account on an invite: a passkey on this device, named `name`. This device is then signed in to it. */
export async function joinWithPasskey(invite: string, name: string): Promise<CloudSession> {
  const options = await (await post('/auth/passkey/join-options', { invite, name })).json() as CreationJSON;
  const response = await create(options);
  const s = await keepSession(await post('/auth/passkey/join', { challenge: options.challenge, response }));
  notePasskeyHere(s);
  return s;
}

/** Signs in with a passkey kept on this device (or on a phone nearby, which the browser offers by itself). */
export async function signInWithPasskey(): Promise<CloudSession> {
  const o = await (await post('/auth/passkey/options', {})).json() as RequestJSON;
  let cred: PublicKeyCredential | null;
  try {
    cred = await navigator.credentials.get({ publicKey: { challenge: fromB64url(o.challenge), rpId: o.rpId, timeout: o.timeout, userVerification: o.userVerification, allowCredentials: [] } }) as PublicKeyCredential | null;
  } catch (e) { throw why(e); }
  if (!cred) throw why(null);
  const r = cred.response as AuthenticatorAssertionResponse;
  const response = {
    id: cred.id, rawId: toB64url(cred.rawId), type: cred.type,
    response: { clientDataJSON: toB64url(r.clientDataJSON), authenticatorData: toB64url(r.authenticatorData), signature: toB64url(r.signature),
      ...(r.userHandle ? { userHandle: toB64url(r.userHandle) } : {}) },
    clientExtensionResults: cred.getClientExtensionResults?.() ?? {},
  };
  const s = await keepSession(await post('/auth/passkey/signin', { challenge: o.challenge, response }));
  notePasskeyHere(s);
  return s;
}

/** Adds a passkey on this device to the account it is signed in to. */
export async function addPasskey(): Promise<void> {
  const s = cloudSession();
  if (!s) throw new Error('Sign in first.');
  const options = await (await post('/me/passkey/options', {}, s.token)).json() as CreationJSON;
  const response = await create(options);
  await (await post('/me/passkey', { challenge: options.challenge, response }, s.token)).text().catch(() => '');
  notePasskeyHere(s);
  globalThis.dispatchEvent?.(new Event(CLOUD_EVENT));
}

/** This device made or used a passkey for the account it is signed in to (so Settings does not offer to add another). */
const PASSKEY_HERE = 'dushu.passkey-here.v1';
export function passkeyHere(): boolean {
  const s = cloudSession();
  try { return !!s && localStorage.getItem(PASSKEY_HERE) === s.email; } catch { return false; }
}
/** Remembers that the sign-in on this device used a passkey. */
export function notePasskeyHere(s: CloudSession): void {
  try { localStorage.setItem(PASSKEY_HERE, s.email); } catch { /* only a hint */ }
}

// ---------------------------------------------------------------- invites ---

export interface Invite { token: string; label: string; max: number; uses: number; created: number }

async function ownerCall(path: string, init: RequestInit = {}): Promise<Response> {
  const s = cloudSession();
  const base = cloudBase();
  if (!s || !base) throw new Error('Sign in first.');
  let res: Response;
  try {
    res = await fetch(`${base}${path}`, { ...init, credentials: 'omit', signal: AbortSignal.timeout(15_000),
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${s.token}`, ...(init.headers as Record<string, string> | undefined) } });
  } catch { throw new Error('Could not reach the sync server. Check this device’s internet connection.'); }
  if (!res.ok) {
    const data = await res.json().catch(() => null) as { error?: string } | null;
    throw new Error(data?.error ?? `The sync server answered ${res.status}.`);
  }
  return res;
}

/** The owner's invite links, newest first. */
export async function listInvites(): Promise<Invite[]> {
  const data = await (await ownerCall('/invites')).json() as { invites?: Invite[] };
  return data.invites ?? [];
}

/** A new invite link: `label` says who it is for, `max` how many accounts it may make. */
export async function createInvite(label: string, max: number): Promise<Invite> {
  const data = await (await ownerCall('/invites', { method: 'POST', body: JSON.stringify({ label, max }) })).json() as { invite: Invite };
  return data.invite;
}

export async function revokeInvite(token: string): Promise<void> {
  await (await ownerCall(`/invites?token=${encodeURIComponent(token)}`, { method: 'DELETE' })).text().catch(() => '');
}

/** The link someone opens to join: this copy of Dushu, at the join screen for the invite. */
export function inviteLink(token: string, base: string = location.href): string {
  const url = new URL(base);
  url.hash = `#/join/${token}`;
  url.search = '';
  return url.href;
}
