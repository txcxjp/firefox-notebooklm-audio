import test from 'node:test';
import assert from 'node:assert/strict';

// ファイル名サニタイズのロジックテスト
function sanitizeFilename(name) {
  const cleaned = (name || '')
    .trim()
    .replace(/[\\/:*?"<>|]/g, '_')
    .replace(/\s+/g, ' ');
  return (cleaned || 'audio_overview').substring(0, 80).trim();
}

test('sanitizeFilename removes illegal characters and limits length', () => {
  const dirty = 'Test/File:With*Illegal?Chars<And>Pipes|OverlyLongNameThatExceedsTheLimitAndKeepsGoingForeverAndEverAndEverAndEverAndEverAndEver';
  const sanitized = sanitizeFilename(dirty);
  
  assert.ok(!/[\\/:*?"<>|]/.test(sanitized), 'Should not contain illegal characters');
  assert.ok(sanitized.length <= 80, 'Should not exceed 80 characters');
  assert.equal(sanitized.startsWith('Test_File_With_Illegal_Chars_And_Pipes_'), true);
});

test('sanitizeFilename handles null or empty input', () => {
  assert.equal(sanitizeFilename(null), 'audio_overview');
  assert.equal(sanitizeFilename(''), 'audio_overview');
  assert.equal(sanitizeFilename('   '), 'audio_overview');
});
