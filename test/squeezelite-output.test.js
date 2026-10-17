'use strict';
const test=require('node:test'),assert=require('node:assert/strict');const {Output,parseDevices}=require('../lib/squeezelite-output');
const binary='/Applications/Squeezelite.app/Contents/MacOS/Squeezelite';
function fixture(platform='darwin'){
 const config=platform==='darwin'?'/agent.plist':'/etc/default/squeezelite',saved={},calls=[];
 const map=new Map([[config,platform==='darwin'?JSON.stringify({Label:'org.randy.squeezelite',ProgramArguments:[binary,'-m','player','-o','default'],KeepAlive:true}):'SL_NAME="Randy"\nSL_SOUNDCARD="default"\nSB_EXTRA_ARGS="-m player"\n']]);
 let running=true,pid=100,fail=false;
 const files={readFile:async p=>map.get(p),writeFile:async(p,v)=>map.set(p,v),rename:async(a,b)=>{map.set(b,map.get(a));map.delete(a);}};
 const run=async(file,args)=>{calls.push([file,...args]);if(args[0]==='-l')return {stdout:platform==='darwin'?'Output devices:\n 1 - Speakers [Core Audio]\n 2 - USB DAC [Core Audio]\n':'Output devices:\n hw:CARD=DAC,DEV=0 - USB DAC\n',stderr:''};
 if(file.endsWith('system_profiler'))return {stdout:JSON.stringify({SPAudioDataType:[{_items:[{_name:'Speakers',coreaudio_default_audio_output_device:'spaudio_yes'}]}]})};
 if(file.endsWith('plutil'))return {stdout:args.includes('json')?map.get(config):''};
 if(file.endsWith('/kill'))throw Error('exited');
 if(args[0]==='print'){if(!running)throw Error('unloaded');return {stdout:'state = running\n pid = '+pid};}
 if(args[0]==='bootout'){running=false;return {stdout:''};}
 if(args[0]==='bootstrap'){if(fail){fail=false;throw Error('bad output');}running=true;pid++;}
 return {stdout:'',stderr:''};};
 const output=new Output({platform,config,binary:platform==='darwin'?binary:'/usr/bin/squeezelite',playerId:'player',uid:501,getSettings:()=>saved,setSetting:(k,v)=>saved[k]=v},{run,files,wait:async()=>{}});
 return {output,calls,saved,map,config,fail:()=>fail=true};
}
test('macOS enumeration retains actual stable PortAudio name and friendly device name',()=>{const devices=parseDevices(' 1 - MacBook Pro Speakers [Core Audio]\n 2 - ZoomAudioDevice [Core Audio]','darwin');assert.equal(devices[0].id,'MacBook Pro Speakers [Core Audio]');assert.equal(devices[0].name,'MacBook Pro Speakers');});
test('ALSA enumeration retains hardware identifiers rather than macOS indices',()=>assert.equal(parseDevices(' hw:CARD=USB,DEV=0 - USB DAC','linux')[0].id,'hw:CARD=USB,DEV=0'));
test('current default is shown by friendly CoreAudio name',async()=>{const f=fixture(),r=await f.output.list();assert.equal(r.current.id,'default');assert.equal(r.current.name,'Speakers');assert.equal(r.canChange,true);});
test('macOS device change updates only -o, supervises one player and persists platform/name/id',async()=>{
 const f=fixture();await f.output.change('USB DAC [Core Audio]');const config=JSON.parse(f.map.get(f.config));assert.equal(config.ProgramArguments.at(-1),'USB DAC [Core Audio]');assert.equal(config.KeepAlive,true);
 assert.deepEqual(f.calls.filter(c=>c[0].endsWith('launchctl')).map(c=>c[1]),['print','bootout','bootstrap','print']);assert.equal(f.saved.squeezeliteOutput.name,'USB DAC');assert.equal(f.saved.squeezeliteOutput.platform,'darwin');
 assert.equal(f.calls.some(c=>c.join(' ').includes('lyrion')||c.join(' ').includes('node ')),false);
});
test('unchanged output avoids a restart',async()=>{const f=fixture();assert.equal((await f.output.change('default')).restarted,false);assert.equal(f.calls.some(c=>c[0].endsWith('launchctl')),false);});
test('unknown device does not touch service configuration',async()=>{const f=fixture();await assert.rejects(f.output.change('999'),/currently available/);assert.equal(f.map.has(f.config+'.randy-backup'),false);});
test('failed output restart restores previous config and attempts supervised recovery',async()=>{const f=fixture();f.fail();await assert.rejects(f.output.change('USB DAC [Core Audio]'),/previous configuration was restored/);assert.equal(JSON.parse(f.map.get(f.config)).ProgramArguments.at(-1),'default');assert.equal(f.saved.squeezeliteOutput,undefined);assert.equal(f.calls.filter(c=>c[1]==='bootstrap').length,2);});
test('Debian updates SL_SOUNDCARD and restarts only squeezelite.service',async()=>{const f=fixture('linux');await f.output.change('hw:CARD=DAC,DEV=0');assert.match(f.map.get(f.config),/SL_SOUNDCARD="hw:CARD=DAC,DEV=0"/);assert.match(f.map.get(f.config),/SB_EXTRA_ARGS="-m player"/);assert.ok(f.calls.some(c=>c[0]==='/usr/bin/systemctl'&&c[2]==='squeezelite.service'));});
test('unavailable enumeration degrades without crashing Randy',async()=>{const output=new Output({},{run:async()=>{throw Error('not installed')}});assert.equal((await output.list()).available,false);});
test('a saved macOS device identifier is not reused on Linux when service config is absent',async()=>{
 const f=fixture('linux');f.saved.squeezeliteOutput={platform:'darwin',id:'MacBook Pro Speakers [Core Audio]',name:'MacBook Pro Speakers'};
 f.output.configuration=async()=>{throw Error('not configured')};
 const result=await f.output.list();assert.equal(result.current.id,'default');assert.equal(result.current.platform,'linux');assert.equal(result.canChange,false);
 assert.notEqual(result.current.name,'MacBook Pro Speakers');
});
