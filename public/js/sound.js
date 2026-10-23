/* global h, storage, icon */
'use strict';

// Sounds for every game, made on the fly with Web Audio (no sound files).
// One 🔊 switch for all games, remembered on this device, plus a 🎵 switch for
// the host's lobby music. Browsers only allow sound after a tap, so the audio
// wakes up on the first tap or key press.

const sfx = (() => {
  const PREFS_KEY = 'sound:prefs';
  let prefs = { on: true, music: false, ...storage(PREFS_KEY) };
  let ctx = null;
  let master = null;
  let noiseBuffer = null;

  function audio() {
    if (!ctx) {
      const Ctx = window.AudioContext || window.webkitAudioContext;
      if (!Ctx) return null;
      ctx = new Ctx();
      master = ctx.createGain();
      master.gain.value = 0.9;
      master.connect(ctx.destination);
    }
    if (ctx.state === 'suspended') ctx.resume().catch(() => {});
    return ctx;
  }
  const wake = () => {
    try {
      audio();
      syncMusic();
    } catch {
      // No audio on this device; the games work without it.
    }
  };
  document.addEventListener('pointerdown', wake, { capture: true });
  document.addEventListener('keydown', wake, { capture: true });

  /* ---------- Building blocks ---------- */

  function tone(freq, at = 0, dur = 0.15, { type = 'sine', vol = 0.2, to = null, attack = 0.005 } = {}) {
    const t = ctx.currentTime + at;
    const osc = ctx.createOscillator();
    const gain = ctx.createGain();
    osc.type = type;
    osc.frequency.setValueAtTime(freq, t);
    if (to) osc.frequency.exponentialRampToValueAtTime(to, t + dur);
    gain.gain.setValueAtTime(0.0001, t);
    gain.gain.exponentialRampToValueAtTime(vol, t + attack);
    gain.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    osc.connect(gain).connect(master);
    osc.start(t);
    osc.stop(t + dur + 0.05);
  }

  function noise(at = 0, dur = 0.1, { vol = 0.2, freq = 1500, q = 0.8 } = {}) {
    if (!noiseBuffer) {
      noiseBuffer = ctx.createBuffer(1, ctx.sampleRate, ctx.sampleRate);
      const data = noiseBuffer.getChannelData(0);
      for (let i = 0; i < data.length; i++) data[i] = Math.random() * 2 - 1;
    }
    const t = ctx.currentTime + at;
    const src = ctx.createBufferSource();
    src.buffer = noiseBuffer;
    const filter = ctx.createBiquadFilter();
    filter.type = 'bandpass';
    filter.frequency.value = freq;
    filter.Q.value = q;
    const gain = ctx.createGain();
    gain.gain.setValueAtTime(vol, t);
    gain.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    src.connect(filter).connect(gain).connect(master);
    src.start(t, Math.random() * 0.5);
    src.stop(t + dur + 0.02);
  }

  const notes = (list, { type = 'triangle', vol = 0.16, gap = 0.12, dur = 0.22 } = {}) => list.forEach((freq, i) => {
    if (freq) tone(freq, i * gap, dur, { type, vol });
  });

  function fanfare(at = 0) {
    [523.25, 659.25, 783.99, 1046.5].forEach((f, i) => tone(f, at + i * 0.11, 0.18, { type: 'triangle', vol: 0.16 }));
    [783.99, 1046.5, 1318.5].forEach((f) => tone(f, at + 0.5, 0.9, { type: 'triangle', vol: 0.12, attack: 0.02 }));
    noise(at + 0.5, 0.7, { freq: 7000, vol: 0.07, q: 0.5 });
  }

  function drumroll(at = 0, length = 1.2) {
    const hits = Math.round(length / 0.045);
    for (let i = 0; i < hits; i++) noise(at + i * 0.045, 0.05, { freq: 1700, vol: 0.04 + (i / hits) * 0.12, q: 0.7 });
    tone(98, at + length, 0.45, { type: 'triangle', vol: 0.3 });
    noise(at + length, 0.8, { freq: 6500, vol: 0.14, q: 0.4 });
  }

  /* ---------- The sounds ---------- */

  const SOUNDS = {
    tick: () => { tone(1900, 0, 0.03, { type: 'square', vol: 0.05 }); noise(0, 0.02, { freq: 3500, vol: 0.06 }); },
    tock: () => { tone(1300, 0, 0.04, { type: 'square', vol: 0.05 }); noise(0, 0.02, { freq: 2500, vol: 0.05 }); },
    urgent: () => tone(1050, 0, 0.07, { type: 'square', vol: 0.1 }),
    correct: () => notes([880, 1318.5], { gap: 0.1, dur: 0.28, vol: 0.18 }),
    wrong: () => { tone(220, 0, 0.4, { type: 'sawtooth', vol: 0.1, to: 130 }); tone(233, 0, 0.4, { type: 'sawtooth', vol: 0.08, to: 138 }); },
    buzz: () => notes([880, 1320], { type: 'sine', gap: 0.09, dur: 0.3, vol: 0.22 }),
    skip: () => tone(700, 0, 0.18, { type: 'triangle', vol: 0.12, to: 350 }),
    steal: () => tone(1400, 0, 0.3, { type: 'triangle', vol: 0.14, to: 300 }),
    spin: () => { noise(0, 0.012, { freq: 4200, vol: 0.12, q: 2 }); tone(2600, 0, 0.012, { type: 'square', vol: 0.03 }); },
    reveal: () => { tone(300, 0, 0.35, { type: 'sine', vol: 0.12, to: 1200 }); tone(1568, 0.3, 0.3, { vol: 0.1 }); tone(2093, 0.4, 0.35, { vol: 0.08 }); },
    drumroll: () => drumroll(0, 1.1),
    win: () => fanfare(0),
    crown: () => { drumroll(0, 1.3); fanfare(1.4); },
    lose: () => notes([392, 370, 349.2, 329.6], { type: 'triangle', gap: 0.3, dur: 0.38, vol: 0.13 }),
    timeUp: () => { tone(320, 0, 0.9, { type: 'square', vol: 0.12, to: 150 }); tone(330, 0, 0.9, { type: 'square', vol: 0.08, to: 155 }); },
    join: () => tone(600, 0, 0.1, { type: 'sine', vol: 0.15, to: 1250 }),
    turn: () => notes([660, 990], { type: 'sine', gap: 0.12, dur: 0.22, vol: 0.16 }),
    night: () => { tone(110, 0, 2.2, { vol: 0.2, attack: 0.5 }); tone(164.8, 0.3, 1.9, { vol: 0.12, attack: 0.5 }); tone(98, 0.8, 1.6, { type: 'triangle', vol: 0.1, attack: 0.4 }); },
    morning: () => notes([784, 987.8, 1174.7, 1568], { type: 'sine', gap: 0.14, dur: 0.5, vol: 0.13 }),
    // «مافيا»'s story: a heartbeat while something is about to happen, and the sniper's shot.
    heartbeat: () => [0, 0.85].forEach((at) => { tone(62, at, 0.16, { vol: 0.42, to: 45 }); tone(55, at + 0.2, 0.2, { vol: 0.3, to: 40 }); }),
    shot: () => { noise(0, 0.09, { freq: 2600, vol: 0.5, q: 0.3 }); tone(110, 0, 0.5, { type: 'triangle', vol: 0.35, to: 38 }); noise(0.06, 0.9, { freq: 700, vol: 0.12, q: 0.5 }); },
  };

  function play(name) {
    if (!prefs.on) return;
    try {
      if (!audio()) return;
      SOUNDS[name]?.();
    } catch {
      // No audio on this device; the games work without it.
    }
  }

  /* ---------- Countdown ticks (host only) ---------- */

  let lastCount = null;
  /** Called by the countdown timers with the lowest second showing (or null); ticks once per second under 6. */
  function countdown(left) {
    if (!api.timerTicks || left === lastCount) return;
    lastCount = left;
    if (left != null) play(left <= 3 ? 'urgent' : 'tick');
  }

  /* ---------- Lobby music: a soft four-chord loop ---------- */

  const CHORDS = [[261.6, 329.6, 392], [220, 261.6, 329.6], [174.6, 220, 261.6], [196, 246.9, 293.7]];
  const PATTERN = [0, 1, 2, 1, 0, 2, 1, 2];
  const BEAT = 0.3;
  let musicWanted = false;
  let musicTimer = null;
  let nextAt = 0;
  let beat = 0;

  function scheduleMusic() {
    if (!ctx || ctx.state !== 'running') return;
    while (nextAt < ctx.currentTime + 0.6) {
      const chord = CHORDS[Math.floor(beat / PATTERN.length) % CHORDS.length];
      const step = beat % PATTERN.length;
      const at = nextAt - ctx.currentTime;
      tone(chord[PATTERN[step]] * 2, at, BEAT * 1.6, { type: 'triangle', vol: 0.035, attack: 0.02 });
      if (step === 0 || step === 4) tone(chord[0] / 2, at, BEAT * 3.5, { vol: 0.06, attack: 0.03 });
      nextAt += BEAT;
      beat += 1;
    }
  }

  function syncMusic() {
    const should = musicWanted && prefs.on && prefs.music && ctx;
    if (should && !musicTimer) {
      nextAt = ctx.currentTime + 0.1;
      musicTimer = setInterval(scheduleMusic, 150);
    } else if (!should && musicTimer) {
      clearInterval(musicTimer);
      musicTimer = null;
    }
  }

  function music(wanted) {
    musicWanted = Boolean(wanted);
    syncMusic();
  }

  /* ---------- The switches ---------- */

  function save(patch) {
    prefs = { ...prefs, ...patch };
    storage(PREFS_KEY, prefs);
    syncMusic();
    renderDock();
  }

  let dockEl = null;
  let dockMusic = false;
  function renderDock() {
    if (!dockEl) return;
    dockEl.replaceChildren(...[
      dockMusic ? h('button', {
        type: 'button',
        class: `dock-btn${prefs.music && prefs.on ? ' on' : ''}`,
        title: prefs.music ? 'وقّف موسيقى الانتظار' : 'شغّل موسيقى الانتظار',
        'aria-label': prefs.music ? 'وقّف موسيقى الانتظار' : 'شغّل موسيقى الانتظار',
        'aria-pressed': String(prefs.music),
        onclick: () => save({ music: !prefs.music, on: prefs.on || !prefs.music }),
      }, icon('music')) : null,
      h('button', {
        type: 'button',
        class: `dock-btn${prefs.on ? ' on' : ''}`,
        title: prefs.on ? 'كتم الصوت' : 'تشغيل الصوت',
        'aria-label': prefs.on ? 'كتم الصوت' : 'تشغيل الصوت',
        'aria-pressed': String(prefs.on),
        onclick: () => save({ on: !prefs.on }),
      }, prefs.on ? icon('volume-2') : icon('volume-x')),
    ].filter(Boolean));
  }

  /** The little sound switches in the corner of the page. */
  function dock({ withMusic = false } = {}) {
    dockMusic = withMusic;
    dockEl = h('div', { class: 'sound-dock' });
    document.body.append(dockEl);
    renderDock();
  }

  const api = { play, countdown, music, dock, timerTicks: false, enabled: () => prefs.on };
  return api;
})();
