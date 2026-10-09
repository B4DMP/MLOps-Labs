/* Mockup-only avatar painter. The game uses Open Peeps (assets/openPeepsAvatar); this is a flat
   stand-in so the mockups render with no build step. Moods mirror the game's emotion faces. */
const Avatars = (() => {
  const hairBack = {
    long: (c) => `<path d="M23 46 Q20 12 50 12 Q80 12 77 46 L81 90 L19 90Z" fill="${c}"/>`,
  };
  const hairFront = {
    short: (c) => `<path d="M27 42 Q24 16 50 16 Q76 16 73 42 Q69 29 50 28 Q31 29 27 42Z" fill="${c}"/>`,
    buzz: (c) => `<path d="M28 39 Q30 19 50 19 Q70 19 72 39 Q63 31 50 31 Q37 31 28 39Z" fill="${c}" opacity=".85"/>`,
    bun: (c) => `<circle cx="50" cy="11" r="9" fill="${c}"/><path d="M27 42 Q24 16 50 16 Q76 16 73 42 Q69 29 50 28 Q31 29 27 42Z" fill="${c}"/>`,
    messy: (c) => `<path d="M26 44 Q20 22 36 18 L37 8 L46 16 L55 7 L60 17 L70 12 L68 21 Q80 26 74 44 Q69 29 50 28 Q31 29 26 44Z" fill="${c}"/>`,
    long: (c) => `<path d="M27 46 Q24 16 50 16 Q76 16 73 46 Q70 30 50 29 Q30 30 27 46Z" fill="${c}"/>`,
  };

  const MOODS = {
    nod:       { bl: 'M33 37 Q39 34 45 37', br: 'M55 37 Q61 34 67 37', mouth: 'M40 57 Q50 67 60 57', cheeks: '#f9a8a8' },
    neutral:   { bl: 'M33 38 L45 38',        br: 'M55 38 L67 38',        mouth: 'M42 59 Q50 62 58 59' },
    skeptical: { bl: 'M32 36 Q38 31 45 36',  br: 'M55 40 L67 38',        mouth: 'M42 60 Q52 58 60 61', squintR: true },
    wince:     { bl: 'M32 40 L44 35',        br: 'M68 40 L56 35',        mouth: 'M41 62 Q45 57 50 60 Q55 63 59 58', sweat: true },
    seethe:    { bl: 'M31 35 L45 40',        br: 'M69 35 L55 40',        mouth: 'M40 60 L60 60', teeth: true, cheeks: '#ef4444', steam: true },
    poker:     { bl: '',                     br: '',                     mouth: 'M43 60 L57 60', shades: true },
  };

  function svg(person, mood = 'neutral', opts = {}) {
    const m = MOODS[mood] || MOODS.neutral;
    const skin = person.skin, shade = 'rgba(0,0,0,.12)';
    const back = (hairBack[person.hair] || (() => ''))(person.hairColor);
    const front = (hairFront[person.hair] || hairFront.short)(person.hairColor);
    const bg = opts.bg || 'transparent';
    const eye = (x, squint) =>
      squint ? `<path d="M${x - 3} 46 L${x + 3} 46" stroke="#2b2118" stroke-width="2.4" stroke-linecap="round"/>`
             : `<circle cx="${x}" cy="46" r="${mood === 'seethe' ? 2.1 : 2.6}" fill="#2b2118"/>`;
    const glasses = person.glasses && !m.shades
      ? `<g fill="none" stroke="#1f2937" stroke-width="1.6"><circle cx="41" cy="46" r="7"/><circle cx="59" cy="46" r="7"/><path d="M48 46 H52"/></g>` : '';
    const shades = m.shades
      ? `<path d="M30 41 H70 V50 Q70 54 66 54 H56 Q52 54 52 49 H48 Q48 54 44 54 H34 Q30 54 30 50Z" fill="#111827"/><path d="M34 44 L40 44" stroke="#9ca3af" stroke-width="1.4" stroke-linecap="round"/><path d="M56 44 L62 44" stroke="#9ca3af" stroke-width="1.4" stroke-linecap="round"/>` : '';
    const eyes = m.shades ? '' : eye(41) + eye(59, m.squintR);
    const brows = m.shades ? '' :
      `<g fill="none" stroke="${person.hairColor}" stroke-width="2.6" stroke-linecap="round"><path d="${m.bl}"/><path d="${m.br}"/></g>`;
    const cheeks = m.cheeks ? `<ellipse cx="34" cy="55" rx="5" ry="3.2" fill="${m.cheeks}" opacity="${mood === 'seethe' ? .45 : .35}"/><ellipse cx="66" cy="55" rx="5" ry="3.2" fill="${m.cheeks}" opacity="${mood === 'seethe' ? .45 : .35}"/>` : '';
    const teeth = m.teeth ? `<path d="M43 57 V62 M48 57 V62 M53 57 V62 M58 57 V62" stroke="#fff" stroke-width="1.2"/>` : '';
    const sweat = m.sweat ? `<path d="M73 33 q5 8 0 11 q-5 -3 0 -11z" fill="#7dd3fc" stroke="#38bdf8" stroke-width=".8"/>` : '';
    const steam = m.steam ? `<g fill="none" stroke="#fca5a5" stroke-width="2.2" stroke-linecap="round" opacity=".95"><path d="M24 24 q-4 -5 0 -9 q4 -4 0 -8"/><path d="M76 24 q4 -5 0 -9 q-4 -4 0 -8"/></g>` : '';
    return `<svg viewBox="0 0 100 100" xmlns="http://www.w3.org/2000/svg" ${opts.attrs || ''}>
      <rect width="100" height="100" fill="${bg}"/>
      ${back}
      <path d="M10 100 Q12 76 36 72 L64 72 Q88 76 90 100Z" fill="${person.shirt}"/>
      <path d="M42 72 L50 84 L58 72Z" fill="rgba(255,255,255,.35)"/>
      <rect x="43" y="62" width="14" height="14" rx="4" fill="${skin}"/><rect x="43" y="62" width="14" height="14" rx="4" fill="${shade}"/>
      <ellipse cx="27.5" cy="47" rx="3.2" ry="5" fill="${skin}"/><ellipse cx="72.5" cy="47" rx="3.2" ry="5" fill="${skin}"/>
      <ellipse cx="50" cy="45" rx="22" ry="24" fill="${skin}"/>
      ${front}${cheeks}${eyes}${glasses}${shades}${brows}
      <path d="${m.mouth}" fill="none" stroke="#7a3b2e" stroke-width="2.3" stroke-linecap="round" stroke-linejoin="round"/>
      ${teeth}${sweat}${steam}
    </svg>`;
  }

  return { svg, MOODS };
})();

/* The five people used by both mockups (real ids, names and metric colours from gameConfig). */
const PEOPLE = {
  reuben: { id: 'reuben', name: 'Reuben', metric: 'Requirements', color: '#8b5cf6', power: 'high', interest: 'high',
            skin: '#e8b894', hair: 'short', hairColor: '#2f2a26', glasses: true, shirt: '#8b5cf6' },
  ruth:   { id: 'ruth', name: 'Ruth', metric: 'Reliability', color: '#e11d48', power: 'high', interest: 'high',
            skin: '#8d5a3b', hair: 'bun', hairColor: '#1c1917', shirt: '#e11d48' },
  dave:   { id: 'dave', name: 'Dave', metric: 'Data', color: '#10b981', power: 'low', interest: 'high',
            skin: '#f1c9a5', hair: 'messy', hairColor: '#7c4a21', shirt: '#10b981' },
  emilia: { id: 'emilia', name: 'Emilia', metric: 'Efficiency', color: '#06b6d4', power: 'low', interest: 'low',
            skin: '#c68642', hair: 'long', hairColor: '#7a2e1c', shirt: '#06b6d4' },
  alex:   { id: 'alex', name: 'Alex', metric: 'Automation', color: '#f97316', power: 'high', interest: 'low',
            skin: '#f3d2b3', hair: 'buzz', hairColor: '#6b7280', shirt: '#f97316' },
};
