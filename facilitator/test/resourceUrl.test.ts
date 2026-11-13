import { describe, expect, it } from 'vitest';
import { screenResourceUrl } from '../src/resourceUrl.js';

/** Every catalogued URL is one an agent may call unattended, so these are the SSRF rules. */
describe('screenResourceUrl', () => {
  it('accepts an ordinary public https resource', () => {
    expect(screenResourceUrl('https://api.example.com/analyze', false)).toEqual({
      ok: true,
      url: 'https://api.example.com/analyze',
    });
  });

  it.each([
    ['not a url', 'analyze'],
    ['a relative path', '/analyze'],
    ['a non-http scheme', 'file:///etc/passwd'],
    ['a gopher scheme', 'gopher://example.com/'],
    ['embedded credentials', 'https://user:pass@example.com/x'],
    ['a loopback name', 'http://localhost:3100/analyze'],
    ['an ip6-localhost name', 'http://ip6-localhost/x'],
    ['a loopback literal', 'http://127.0.0.1:3100/analyze'],
    ['link-local metadata', 'http://169.254.169.254/latest/meta-data/'],
    ['a private range literal', 'http://10.0.0.5/internal'],
    ['another private range', 'http://192.168.1.1/admin'],
    ['a decimal-encoded ip', 'http://2130706433/'],
    ['a hex-encoded ip', 'http://0x7f000001/'],
    ['an ipv6 literal', 'http://[::1]/x'],
    ['an internal suffix', 'http://billing.internal/x'],
    ['an mdns suffix', 'http://printer.local/x'],
    ['a bare hostname', 'http://intranet/x'],
  ])('rejects %s', (_label, url) => {
    const verdict = screenResourceUrl(url, false);
    expect(verdict.ok).toBe(false);
  });

  it('rejects a url past the length cap', () => {
    const long = `https://example.com/${'a'.repeat(4000)}`;
    expect(screenResourceUrl(long, false)).toMatchObject({ ok: false });
  });

  it('allows loopback when private resource urls are explicitly enabled', () => {
    expect(screenResourceUrl('http://localhost:3100/analyze', true)).toMatchObject({ ok: true });
  });

  it('still refuses a non-http scheme even when private urls are enabled', () => {
    expect(screenResourceUrl('file:///etc/passwd', true)).toMatchObject({ ok: false });
  });

  /**
   * `svc.internal.` is the rooted form of `svc.internal` and DNS resolves the two to the
   * same name, so every rule above has to survive a trailing dot. Node's URL parser
   * normalizes IPv4 forms itself (`http://127.0.0.1./` arrives as `127.0.0.1`), so it is
   * the named hosts that need covering.
   */
  describe('rooted (trailing-dot) hosts', () => {
    it.each([
      ['a rooted loopback name', 'http://localhost./x'],
      ['a rooted localhost.localdomain', 'http://localhost.localdomain./x'],
      ['a rooted ip6-localhost', 'http://ip6-localhost./x'],
      ['a rooted ip6-loopback', 'http://ip6-loopback./x'],
      ['a rooted .localhost suffix', 'http://svc.localhost./x'],
      ['a rooted .local suffix', 'http://printer.local./x'],
      ['a rooted .internal suffix', 'http://svc.internal./x'],
      ['a rooted .intranet suffix', 'http://wiki.intranet./x'],
      ['a rooted .home.arpa suffix', 'http://nas.home.arpa./x'],
      ['a rooted bare hostname', 'http://intranet./x'],
      ['a doubly rooted loopback name', 'http://localhost../x'],
      ['a host that is only a root label', 'http://./x'],
      ['a host of nothing but root labels', 'http://../x'],
    ])('rejects %s', (_label, url) => {
      expect(screenResourceUrl(url, false).ok).toBe(false);
    });

    it('still accepts a rooted public hostname', () => {
      expect(screenResourceUrl('https://api.example.com./analyze', false)).toMatchObject({ ok: true });
    });

    it('returns the url as declared, without rewriting the host', () => {
      // The root label is stripped for matching only; the catalogued URL stays byte-exact
      expect(screenResourceUrl('https://api.example.com./analyze', false)).toEqual({
        ok: true,
        url: 'https://api.example.com./analyze',
      });
    });
  });
});
