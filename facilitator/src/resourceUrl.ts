import { domainToASCII } from 'node:url';

/**
 * Screening for resource URLs before they enter the discovery catalog.
 *
 * A catalogued URL is what an agent reading GET /discovery/resources will call, and it
 * arrives in the buyer's payment payload, so it is attacker-chosen. Left unscreened the
 * catalog can hand out `http://169.254.169.254/latest/meta-data/` or a loopback address
 * and turn every auto-calling consumer into a request forger on our behalf.
 *
 * The host rules mirror the ones the SDK already applies to `iconUrl`
 * (`isValidIconUrl`): IDN normalization, then loopback names, IPv4 literals,
 * decimal-encoded and hex-encoded hosts refused. The resource URL is the field agents
 * actually call, so it gets at least the same treatment, plus IPv6 literals and the
 * internal-use suffixes.
 */

/** A URL longer than this is refused outright; catalog rows are served publicly. */
export const MAX_RESOURCE_URL_LENGTH = 2048;

const LOOPBACK_HOSTNAMES = new Set(['localhost', 'localhost.localdomain', 'ip6-localhost', 'ip6-loopback']);
const INTERNAL_SUFFIXES = ['.localhost', '.local', '.internal', '.intranet', '.home.arpa'];

const IPV4_REGEX = /^\d{1,3}\.\d{1,3}\.\d{1,3}\.\d{1,3}$/;
const ALL_DIGITS_REGEX = /^\d+$/;
const HEX_LITERAL_REGEX = /^0x[0-9a-f]+$/i;

export type ResourceUrlVerdict = { ok: true; url: string } | { ok: false; reason: string };

/**
 * Screen a declared resource URL. `allowPrivate` relaxes only the host rules, for local
 * development against a seller on localhost; the scheme and shape rules always apply.
 */
export function screenResourceUrl(value: unknown, allowPrivate: boolean): ResourceUrlVerdict {
  if (typeof value !== 'string' || value.length === 0) {
    return { ok: false, reason: 'resource.url must be an absolute http(s) URL' };
  }
  if (value.length > MAX_RESOURCE_URL_LENGTH) {
    return { ok: false, reason: `resource.url must be at most ${MAX_RESOURCE_URL_LENGTH} characters` };
  }

  let parsed: URL;
  try {
    parsed = new URL(value);
  } catch {
    return { ok: false, reason: 'resource.url must be an absolute http(s) URL' };
  }

  if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') {
    return { ok: false, reason: 'resource.url must be an absolute http(s) URL' };
  }
  // Credentials in a catalogued URL would be republished to every reader
  if (parsed.username !== '' || parsed.password !== '') {
    return { ok: false, reason: 'resource.url must not carry credentials' };
  }

  if (allowPrivate) {
    return { ok: true, url: value };
  }

  let hostname: string;
  try {
    hostname = decodeURIComponent(parsed.hostname);
  } catch {
    return { ok: false, reason: 'resource.url host is not decodable' };
  }
  // Fold IDN and unicode homoglyph forms down to ASCII before matching
  const ascii = domainToASCII(hostname);
  hostname = (ascii === '' ? hostname : ascii).toLowerCase();
  // Drop the root label. DNS resolves `svc.internal.` and `svc.internal` to the same name,
  // so without this the rooted form slips past the loopback set and the suffix list below.
  // Node's URL parser normalizes IPv4 forms (`127.0.0.1.` arrives as `127.0.0.1`) but
  // leaves named hosts as written, so only names need this.
  hostname = hostname.replace(/\.+$/, '');

  if (hostname === '') {
    return { ok: false, reason: 'resource.url must have a host' };
  }
  if (hostname.startsWith('[')) {
    return { ok: false, reason: 'resource.url host must not be an IPv6 literal' };
  }
  if (LOOPBACK_HOSTNAMES.has(hostname)) {
    return { ok: false, reason: 'resource.url host must not be a loopback address' };
  }
  // Every IPv4 literal is refused, private or not: a catalogued resource needs a name
  if (IPV4_REGEX.test(hostname)) {
    return { ok: false, reason: 'resource.url host must be a domain name, not an IP literal' };
  }
  // http://2130706433/ and http://0x7f000001/ are both 127.0.0.1
  if (ALL_DIGITS_REGEX.test(hostname) || HEX_LITERAL_REGEX.test(hostname)) {
    return { ok: false, reason: 'resource.url host must be a domain name, not an encoded IP literal' };
  }
  if (INTERNAL_SUFFIXES.some((suffix) => hostname.endsWith(suffix))) {
    return { ok: false, reason: 'resource.url host must not be an internal-use domain' };
  }
  // A bare label ("intranet", "db") resolves against the search domain, not the public DNS
  if (!hostname.includes('.')) {
    return { ok: false, reason: 'resource.url host must be a fully qualified domain name' };
  }

  return { ok: true, url: value };
}
