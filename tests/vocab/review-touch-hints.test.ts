// The Space and 1-4 key chips in review are keyboard hints; touch-only devices must not show them.
import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

const css = readFileSync(join(__dirname, '..', '..', 'src', 'styles', 'review.css'), 'utf8');

describe('review key hints', () => {
  it('hides every .kbd chip on touch-only devices and keeps them elsewhere', () => {
    expect(css).toMatch(/@media \(hover: none\) and \(pointer: coarse\) \{\s*\.rev-page \.kbd \{ display: none; \}\s*\}/);
    // No unconditional rule hides them for everyone.
    const outside = css.replace(/@media[^{]*\{(?:[^{}]*\{[^}]*\})*[^}]*\}/g, '');
    expect(outside).not.toMatch(/\.kbd[^{]*\{[^}]*display:\s*none/);
  });
});
