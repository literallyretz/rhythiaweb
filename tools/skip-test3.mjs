import fs from 'node:fs';
import { parseSSPM } from '../src/map/MapParser.js';
import { Attempt } from '../src/game/Attempt.js';
import { Runner } from '../src/game/Runner.js';
import { createSettings } from '../src/settings.js';
const map = parseSSPM(new Uint8Array(fs.readFileSync(new URL('../assets/maps/girls_legend_u.sspm', import.meta.url))), 'x');
for (let i=100;i<map.Notes.length;i++) map.Notes[i].Millisecond+=10000;   // synthetic 10 s break after note 99
map.Length+=10000;
const colors=[[1,0,.35]]; const s=createSettings(); let pos=0;
const snd={playHitSound(){},playMissSound(){},playFailSound(){},timeSinceLastMix:()=>0,song:{playing:false,pitchScale:1,getPlaybackPosition:()=>pos/1000,getLength:()=>200000,play(){this.playing=true},stop(){},seek(){},setPaused(){}}};
const a=new Attempt(map,1,0,s,colors,0), r=new Runner(snd); r.noteColors=colors; r.onStop=()=>console.log('STOP',Math.round(a.Progress)); r.Play(a,s);
let n0=0;
for(let f=0;f<400000&&!a.Stopped&&a.Progress<50000;f++){
  const n=map.Notes[r.ObjectIndicesStart.Note]; if(n){a.CursorPosition.x=n.X;a.CursorPosition.y=n.Y;}
  r.process(1/120); pos=a.Progress;
  if(a.CanSkip&&a.Progress>0){ const b=[Math.round(a.Progress),r.ObjectIndicesStart.Note,r.ObjectIndicesEnd.Note]; r.Skip(); console.log('skip',b,'->',Math.round(a.Progress),r.ObjectIndicesStart.Note,r.ObjectIndicesEnd.Note); }
  if(f%120==0&&a.Progress>20000&&a.Progress<26000) console.log(Math.round(a.Progress),r.ObjectIndicesStart.Note,r.ObjectIndicesEnd.Note,a.Hits,a.Misses);
}
console.log('end',Math.round(a.Progress),'hits',a.Hits,'misses',a.Misses);
