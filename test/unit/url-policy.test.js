import assert from 'node:assert/strict';
import test from 'node:test';
import { normalizeTargetUrl } from '../../src/url-policy.js';

test('WHATWG parsing normalizes an allowed HTTPS target', () => {
  assert.equal(
    normalizeTargetUrl('HTTPS://Example.COM:443/a/../b?q=1#part'),
    'https://example.com/b?q=1#part',
  );
});

test('target policy rejects executable schemes, credentials, local service hosts, and controls', () => {
  const blocked = [
    'javascript:alert(1)',
    'file:///etc/passwd',
    'https://user:pass@example.com/',
    'http://localhost/admin',
    'https://short.example/r/loop',
    'https://example.com/\nnext',
  ];
  for (const target of blocked) {
    assert.throws(
      () => normalizeTargetUrl(target, { blockedHosts: ['short.example'] }),
      { name: 'ValidationError' },
      target,
    );
  }
});

test('target policy accepts public HTTP and HTTPS names without claiming destination safety', () => {
  assert.equal(normalizeTargetUrl('http://example.net/path'), 'http://example.net/path');
  assert.equal(normalizeTargetUrl('https://xn--bcher-kva.example/'), 'https://xn--bcher-kva.example/');
});

test('target policy enforces the UTF-8 byte limit after parsing', () => {
  const oversized = `https://example.com/${'界'.repeat(1400)}`;
  assert.throws(() => normalizeTargetUrl(oversized), /4096 UTF-8 bytes/);
});
