import fs from 'node:fs';
import { parseSSPM } from '../src/map/MapParser.js';
import { Attempt } from '../src/game/Attempt.js';
import { Runner } from '../src/game/Runner.js';
import { createSettings } from '../src/settings.js';
const map = parseSSPM(new Uint8Array(fs.readFileSync(new URL('../assets/maps/girls_legend_u.sspm', import.meta.url))), 'x');
const gaps=[]; for(let i=1;i<map.Notes.length;i++) gaps.push([map.Notes[i].Millisecond-map.Notes[i-1].Millisecond,i]); gaps.sort((a,b)=>b[0]-a[0]); console.log('biggest gaps', gaps.slice(0,4));
const colors=[[1,0,.35]]; const s=createSettings();
const snd={playHitSound(){},playMissSound(){},playFailSound(){},timeSinceLastMix:()=>0,song:{playing:false,pitchScale:1,getPlaybackPosition:()=>pos/1000,getLength:()=>100000,play(){this.playing=true},stop(){},seek(){},setPaused(){}}}; let pos=0;
const a=new Attempt(map,1,0,s,colors,0), r=new Runner(snd); r.noteColors=colors; r.onStop=()=>console.log('STOP at',a.Progress); r.Play(a,s);
const target=map.Notes[gaps[0][1]-1].Millisecond+3000; let skipped=false;
for(let f=0;f<200000&&a.Progress<target+8000;f++){ r.process(1/120); pos=a.Progress;
  if(!skipped&&a.CanSkip&&a.Progress>2000){ console.log('before skip',Math.round(a.Progress),r.ObjectIndicesStart.Note,r.ObjectIndicesEnd.Note); r.Skip(); skipped=true; console.log('after skip',Math.round(a.Progress),r.ObjectIndicesStart.Note,r.ObjectIndicesEnd.Note);}
  if(skipped&&f%60==0&&r.ObjectIndicesStart.Note>0) {}
}
console.log('end',Math.round(a.Progress),r.ObjectIndicesStart.Note,r.ObjectIndicesEnd.Note,'canSkip',a.CanSkip);
