import fs from 'node:fs';
import { parseSSPM } from '../src/map/MapParser.js';
import { Attempt } from '../src/game/Attempt.js';
import { Runner } from '../src/game/Runner.js';
import { createSettings } from '../src/settings.js';
const bytes = new Uint8Array(fs.readFileSync(new URL('../assets/maps/girls_legend_u.sspm', import.meta.url)));
const colors=[[1,0,.35]]; let pos=0;
const snd={playHitSound(){},playMissSound(){},playFailSound(){},song:{playing:false,pitchScale:1,getPlaybackPosition:()=>pos/1000,getLength:()=>200000,play(){this.playing=true},stop(){},seek(){},setPaused(){}}};
function run(map){ const s=createSettings(); const a=new Attempt(map,1,0,s,colors,0), r=new Runner(snd); r.noteColors=colors; r.onStop=()=>{}; r.Play(a,s);
  for(let f=0;f<20000&&!a.Stopped&&a.Progress<20000;f++){ const n=map.Notes[r.ObjectIndicesStart.Note]; if(n){a.CursorPosition.x=n.X;a.CursorPosition.y=n.Y;} r.process(1/120); pos=a.Progress; if(a.CanSkip&&a.Progress>0) r.Skip(); }
  return a.Hits; }
const shared = parseSSPM(bytes,'x');
console.log('shared map: attempt1 hits', run(shared), ' attempt2 hits', run(shared));
console.log('fresh decode: attempt1 hits', run(parseSSPM(bytes,'x')), ' attempt2 hits', run(parseSSPM(bytes,'x')));
