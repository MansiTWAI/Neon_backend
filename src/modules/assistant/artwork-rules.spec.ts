import { describe, expect, it } from 'vitest';
import { planByRules, wordsIn } from './artwork.service';

describe('wordsIn', () => {
  it('keeps a couple joined by a heart', () => {
    expect(wordsIn('Create a romantic design with the name Rahul ❤️ Priya, glowing red hearts')).toEqual([
      'Rahul ❤️ Priya',
    ]);
  });

  it('reads a name after "for" with its emoji', () => {
    expect(wordsIn('Generate a birthday poster for Ananya 🎂 with a pink-and-gold theme')).toEqual([
      'Ananya 🎂',
    ]);
  });

  it('prefers quoted text', () => {
    expect(wordsIn('Gym wall art saying "No Pain No Gain" in red')).toEqual(['No Pain No Gain']);
  });

  it('does not split ordinary words on "and"', () => {
    expect(wordsIn('A Holland Park sunset with a pink-and-gold sky')).toEqual([]);
  });
});

describe('planByRules', () => {
  it('picks a style and colours from the words and keeps names out of the scene', () => {
    const plan = planByRules({
      prompt: 'Birthday poster for Ananya 🎂 with a pink and gold theme',
      style: 'auto',
      aspect: 'square',
    });
    expect(plan.style).toBe('festive');
    expect(plan.lines).toEqual([{ text: 'Ananya 🎂', size: 'lg' }]);
    expect(plan.scene).not.toContain('Ananya');
    expect(plan.color).toBe('#ff5fa2');
  });

  it('uses the exact lines the customer typed', () => {
    const plan = planByRules({
      prompt: 'neon gaming logo',
      style: 'neon',
      aspect: 'square',
      text: ['Ravi 🔥'],
    });
    expect(plan.lines).toEqual([{ text: 'Ravi 🔥', size: 'lg' }]);
  });
});
