// Node tests for the pure gameplay logic (no browser). Run: node tools/test-logic.mjs
import fs from 'node:fs';
import { parseSSPM } from '../src/map/MapParser.js';
import { Note, HitResult } from '../src/map/Note.js';
import { Attempt } from '../src/game/Attempt.js';
import { Runner } from '../src/game/Runner.js';
import { createSettings } from '../src/settings.js';
import { BOUNDS } from '../src/constants.js';

let pass = 0, fail = 0;
const ok = (c, msg) => { if (c) { pass++; console.log('  ok   ' + msg); } else { fail++; console.log('  FAIL ' + msg); } };
const colors = [[1, 0, 0.35], [1, 0.85, 0.9]];

function fakeSound() {
  const s = { hits: 0, misses: 0, fails: 0, playHitSound() { s.hits++; }, playMissSound() { s.misses++; }, playFailSound() { s.fails++; },
    song: { playing: false, pitchScale: 1, getPlaybackPosition: () => s.pos / 1000, getLength: () => 100000, play() { this.playing = true; }, stop() { this.playing = false; }, seek() {}, setPaused() {} }, pos: 0 };
  return s;
}
function makeRun(map, settings = createSettings()) {
  const sound = fakeSound();
  const a = new Attempt(map, 1, 0, settings, colors, 0);
  const r = new Runner(sound);
  r.noteColors = colors;
  let stopped = false; r.onStop = () => { stopped = true; };
  r.Play(a, settings);
  return { a, r, sound, stopped: () => stopped };
}
const DT = 1 / 120;
function tick(run) { run.r.process(DT); run.sound.pos = run.a.Progress; }

// ---------- 1. parser vs independent Python decode ----------
console.log('[1] SSPM parser vs independent decoder');
const file = new Uint8Array(fs.readFileSync(new URL('../assets/maps/girls_legend_u.sspm', import.meta.url)));
const map = parseSSPM(file, 'girls_legend_u');
const ref = JSON.parse(fs.readFileSync('/tmp/ref_notes.json'));
ok(map.Notes.length === ref.count && ref.count === 593, `note count ${map.Notes.length}`);
ok(map.Length === ref.length, `map length ${map.Length} ms`);
let mism = 0; for (let i = 0; i < ref.notes.length; i++) { const n = map.Notes[i], r = ref.notes[i]; if (n.Index !== r[0] || n.Millisecond !== r[1] || n.X !== r[2] || n.Y !== r[3]) mism++; }
ok(mism === 0, `all 593 notes (index/ms/x/y) identical to reference (mismatches: ${mism})`);
ok(map.AudioBuffer.length === ref.audio_len && String.fromCharCode(...map.AudioBuffer.slice(0, 3)) === 'ID3', `audio ${map.AudioBuffer.length} B (MP3/ID3)`);
ok(map.CoverBuffer.length === ref.cover_len, `cover ${map.CoverBuffer.length} B`);
console.log(`       title="${map.PrettyTitle}" mappers="${map.PrettyMappers}" diff=${map.DifficultyName}`);
const xs = new Set(map.Notes.map((n) => n.X)), ys = new Set(map.Notes.map((n) => n.Y));
console.log(`       distinct X: ${[...xs].sort()}  Y: ${[...ys].sort()}`);

// ---------- 2. Attempt initial state ----------
console.log('[2] Attempt init (Attempt.cs)');
{ const s = createSettings(); const a = new Attempt(map, 1, 0, s, colors, 0);
  ok(Math.abs(s.ApproachTime - 0.5) < 1e-12, 'ApproachTime = AD/AR = 0.5 s');
  ok(a.Progress === -1500, `Progress starts at ${a.Progress} (= -1000*speed - AT*1000)`);
  ok(a.ComboMultiplierIncrement === 2, `ComboMultiplierIncrement = max(2, 593/200) = ${a.ComboMultiplierIncrement}`);
  ok(a.Length === map.Length + 1000, `Length = ${a.Length}`);
  ok(a.LastHitColour === colors[1], 'LastHitColour = last colour (^1) when FirstNote = 0'); }

// ---------- 3. hit window boundaries ----------
console.log('[3] Hit window / hitbox boundaries (Note.cs)');
function single(cursor, atProgress) {
  const m = { Name: 't', Length: 5000, Notes: [new Note(0, 1000, 0, 0), new Note(1, 4000, 1, 1)], AudioBuffer: null };
  const run = makeRun(m);
  run.r.firstFrame = false;
  run.a.CursorPosition = cursor;
  run.a.Progress = atProgress - 1e-9;
  run.r.ProcessObjects();           // before the note time: nothing may happen
  run.a.Progress = atProgress;
  run.r.ProcessObjects();
  return run.a.Map.Notes[0].LastResult;
}
ok(single({ x: 0, y: 0 }, 999) === HitResult.None, 'before note time: not hittable');
ok(single({ x: 0, y: 0 }, 1000) === HitResult.Hit, 'cursor on note at t=ms: Hit');
ok(single({ x: 0, y: 0 }, 1055) === HitResult.Hit, 'cursor on note at ms+55: still Hit (window inclusive)');
ok(single({ x: 0, y: 0 }, 1055.5) === HitResult.Miss, 'ms+55.5: Miss');
ok(single({ x: 0.57, y: 0 }, 1010) === HitResult.Hit, 'cursor x=0.57 (0.5+0.07 edge): Hit');
ok(single({ x: 0.5701, y: 0 }, 1010) === HitResult.None, 'cursor x=0.5701 outside hitbox: pending');
ok(single({ x: 0, y: -0.5701 }, 1010) === HitResult.None, 'y outside hitbox: pending');
ok(single({ x: 0.5701, y: 0 }, 1056) === HitResult.Miss, 'outside hitbox until window ends: Miss');

// ---------- 4. scoring / combo / multiplier ----------
console.log('[4] Scoring maths (Runner.onHitResultChanged)');
{ // 6 notes at identical lateness 0, cursor on all (x=y=0)
  const notes = Array.from({ length: 10 }, (_, i) => new Note(i, 1000 + i * 100, 0, 0));
  const m = { Name: 't', Length: 3000, Notes: notes, AudioBuffer: null };
  const run = makeRun(m); run.r.firstFrame = false; run.a.CursorPosition = { x: 0, y: 0 };
  const scores = [];
  for (let i = 0; i < 10; i++) { run.a.Progress = notes[i].Millisecond; run.r.ProcessObjects(); scores.push(run.a.Score); }
  // increment=2 -> multiplier 1,1,2,2,3,3,4,4,5,5 on hit #1..10 (hit scored with the multiplier *before* it is bumped)
  const expectMult = [1, 1, 2, 2, 3, 3, 4, 4, 5, 5]; let expect = 0; const per = [];
  for (const m_ of expectMult) { expect += 100 * m_; per.push(expect); }
  ok(JSON.stringify(scores) === JSON.stringify(per), `cumulative score ${scores.join(',')}`);
  ok(run.a.ComboMultiplier === 6 && run.a.Combo === 10 && run.a.Hits === 10 && run.a.Accuracy === 100, 'combo 10, multiplier 6x, accuracy 100');
  // lateness: 40 ms late -> factor = 1 - (40-25)/150 = 0.9
  const run2 = makeRun({ Name: 't', Length: 3000, Notes: [new Note(0, 1000, 0, 0)], AudioBuffer: null });
  run2.r.firstFrame = false; run2.a.CursorPosition = { x: 0, y: 0 }; run2.a.Progress = 1040; run2.r.ProcessObjects();
  ok(run2.a.Score === Math.floor(100 * Math.fround(0.9)), `40 ms late -> score ${run2.a.Score} (expected ${Math.floor(100 * Math.fround(0.9))})`); }

// ---------- 5. accuracy + health ----------
console.log('[5] Accuracy / health / fail (Runner.updateHealth, checkFail)');
{ const notes = Array.from({ length: 6 }, (_, i) => new Note(i, 1000 + i * 100, 1, 1));
  const run = makeRun({ Name: 't', Length: 3000, Notes: notes, AudioBuffer: null }); run.r.firstFrame = false;
  run.a.CursorPosition = { x: -1, y: -1 };
  const hp = []; for (let i = 0; i < 6; i++) { run.a.Progress = notes[i].Millisecond + 56; run.r.ProcessObjects(); hp.push(+run.a.Health.toFixed(3)); if (!run.r.Playing && i >= 0) break; }
  // step 15 -> 85, then step 18 -> 67, 21.6 -> 45.4, 25.92 -> 19.48, 31.104 -> 0 (clamped)
  ok(hp[0] === 85 && hp[1] === 67 && Math.abs(hp[2] - 45.4) < 1e-9 && Math.abs(hp[3] - 19.48) < 1e-9, `health after misses: ${hp.join(' / ')}`);
  ok(run.a.Health === 0 && run.a.Alive === false && run.a.Qualifies === false, 'health 0 -> Fail(): Alive=false, Qualifies=false');
  ok(run.r.StopQueued === true && run.r.Playing === false, 'QueueStop() fired on health<=0');
  ok(run.a.Accuracy === 0 && run.a.Misses === 5, `accuracy ${run.a.Accuracy}, misses ${run.a.Misses}`);
  }
{ // accuracy rounding: 2 hits / 3 notes -> floor(66.666..)/100 = 66.66 ; miss branch uses float division
  const notes = [new Note(0, 1000, 0, 0), new Note(1, 1100, 0, 0), new Note(2, 1200, 1, 1)];
  const run = makeRun({ Name: 't', Length: 3000, Notes: notes, AudioBuffer: null }); run.r.firstFrame = false; run.a.CursorPosition = { x: 0, y: 0 };
  for (const n of notes) { run.a.Progress = n.Millisecond + (n.X === 1 ? 56 : 0); run.r.ProcessObjects(); }
  ok(run.a.Accuracy === Math.fround(66.66), `accuracy after 2 hit + 1 miss = ${run.a.Accuracy}`); }

// ---------- 6. full simulated plays at 120 Hz ----------
console.log('[6] Full-map simulation at fixed 120 Hz');
function play(botFn) {
  const run = makeRun(parseSSPM(file, 'x'));
  let ticks = 0;
  while (!run.stopped() && ticks < 120 * 130) {
    botFn(run); tick(run); ticks++;
    if (!run.r.Playing && run.r.StopQueued) { run.r.process(0); } // QueueStop leaves a queued stop; drive it like the frame loop would
  }
  return { run, ticks };
}
{ const { run, ticks } = play((run) => {            // perfect bot: sit on the next unresolved note
    const a = run.a; const i = run.r.ObjectIndicesStart.Note; const n = a.Map.Notes.find((n, idx) => idx >= i && n.LastResult === 0);
    if (n) a.CursorPosition = { x: n.X, y: n.Y }; });
  const a = run.a;
  ok(run.stopped(), `perfect run ended after ${(ticks / 120).toFixed(1)} s sim time (${ticks} ticks)`);
  ok(a.Hits === 593 && a.Misses === 0 && a.Accuracy === 100 && a.Combo === 593 && a.Health === 100 && a.Alive && a.Qualifies, `hits ${a.Hits}/${a.Sum}, acc ${a.Accuracy}, combo ${a.Combo}, hp ${a.Health}`);
  ok(a.ComboMultiplier === 8, `multiplier reached ${a.ComboMultiplier}x`);
  console.log(`       final score ${a.Score}`);
  ok(run.sound.hits === 593, `hit sound triggered ${run.sound.hits}x`); }
{ const { run } = play((run) => { run.a.CursorPosition = { x: -BOUNDS, y: -BOUNDS }; }); // never hits anything near the centre
  const a = run.a;
  ok(run.stopped() && !a.Alive && a.Health === 0, `idle run: failed (hp ${a.Health}) after ${a.Sum} judged notes, misses ${a.Misses}, hits ${a.Hits}`);
  ok(run.sound.fails === 1, 'fail sound played exactly once'); }
{ // 120 Hz vs 240 Hz step: judgement outcome of the perfect bot should not depend on step size
  const stepRun = (dt) => { const run = makeRun(parseSSPM(file, 'x')); let g = 0;
    while (!run.stopped() && g++ < 1e6) { const a = run.a; const i = run.r.ObjectIndicesStart.Note; const n = a.Map.Notes.find((n, idx) => idx >= i && n.LastResult === 0); if (n) a.CursorPosition = { x: n.X, y: n.Y }; run.r.process(dt); run.sound.pos = a.Progress; }
    return run.a; };
  const a1 = stepRun(1 / 120), a2 = stepRun(1 / 240);
  ok(a1.Hits === a2.Hits && a1.Misses === a2.Misses, `120 Hz vs 240 Hz: hits ${a1.Hits}/${a2.Hits}; score ${a1.Score} vs ${a2.Score} (score differs only by lateness quantisation)`); }

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
