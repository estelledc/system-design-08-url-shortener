import assert from 'node:assert/strict';
import test from 'node:test';
import {
  BASE62_ALPHABET,
  codeSpace,
  createRandomCode,
  encodeBase62,
} from '../../src/code.js';

test('Base62 capacity arithmetic is exact', () => {
  assert.equal(codeSpace(7), 3_521_614_606_208n);
  assert.equal(codeSpace(8), 218_340_105_584_896n);
  assert.equal(codeSpace(8) > 365_000_000_000n, true);
});

test('random code generation maps each supplied index without modulo workarounds', () => {
  const indexes = [0, 9, 10, 35, 36, 61, 1, 60];
  const code = createRandomCode({ randomIndex: () => indexes.shift() });
  assert.equal(code, '09azAZ1Y');
});

test('random code generator rejects an out-of-alphabet source', () => {
  assert.throws(() => createRandomCode({ randomIndex: () => 62 }), /outside the Base62 alphabet/);
});

test('Base62 encoding crosses alphabet boundaries predictably', () => {
  assert.equal(encodeBase62(0n), '0');
  assert.equal(encodeBase62(61n), 'Z');
  assert.equal(encodeBase62(62n), '10');
  assert.equal(encodeBase62(3_521_614_606_207n), 'ZZZZZZZ');
});

test('every Base62 digit round-trips through the alphabet order', () => {
  for (let index = 0; index < BASE62_ALPHABET.length; index += 1) {
    assert.equal(encodeBase62(BigInt(index)), BASE62_ALPHABET[index]);
  }
});
