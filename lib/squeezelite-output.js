'use strict';
const fs = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');
const {promisify} = require('node:util');
const execFile = promisify(require('node:child_process').execFile);

function parseDevices(output, platform) {
    const devices=[];
    const lines=output.split(/\r?\n/);
    for(let i=0;i<lines.length;i++) {
        if(platform==='darwin') {
            const match=lines[i].match(/^\s*(\d+)\s+-\s+(.+?)\s+\[([^\]]+)\]\s*$/);
            if(match)devices.push({id:match[2]+' ['+match[3]+']',index:match[1],name:match[2],platform});
        } else {
            const match=lines[i].match(/^\s*((?:hw|plughw|default|sysdefault|front|iec958|hdmi)(?::[^\s]+)?)\s*(?:-\s*(.*))?$/);
            if(match)devices.push({id:match[1],name:match[2] || lines[i+1]?.trim() || match[1],platform});
        }
    }
    return devices;
}
class Output {
    constructor(options={},dependencies={}) {
        this.platform=options.platform || process.platform;
        this.binary=options.binary || process.env.SQUEEZELITE_BINARY || (this.platform==='darwin'?'/Applications/Squeezelite.app/Contents/MacOS/Squeezelite':'/usr/bin/squeezelite');
        this.config=options.config || (this.platform==='darwin'?path.join(os.homedir(),'Library/LaunchAgents/org.randy.squeezelite.plist'):'/etc/default/squeezelite');
        this.playerId=options.playerId;
        this.run=dependencies.run || ((file,args)=>execFile(file,args,{timeout:12000,maxBuffer:1024*1024}));
        this.files=dependencies.files || fs;
        this.getSettings=options.getSettings || (()=>({}));this.setSetting=options.setSetting || (()=>{});
        this.uid=options.uid ?? process.getuid?.();this.wait=dependencies.wait || (ms=>new Promise(resolve=>setTimeout(resolve,ms)));
    }
    async configuration() {
        if(this.platform==='darwin') {
            const {stdout}=await this.run('/usr/bin/plutil',['-convert','json','-o','-',this.config]);
            const plist=JSON.parse(stdout),args=plist.ProgramArguments;
            if(plist.Label!=='org.randy.squeezelite'||!Array.isArray(args)||args[0]!==this.binary)throw new Error('Randy Squeezelite LaunchAgent is not configured');
            if(this.playerId && args[args.indexOf('-m')+1]!==this.playerId)throw new Error('Managed Squeezelite player does not match the configured LMS player');
            return {id:args.includes('-o')?args[args.indexOf('-o')+1]:'default',plist};
        }
        if(this.platform!=='linux')throw new Error('Audio output selection is unavailable on this platform');
        const text=await this.files.readFile(this.config,'utf8');
        const id=text.match(/^SL_SOUNDCARD=["']?([^"'\r\n]+)["']?\s*$/m)?.[1] || 'default';
        return {id,text};
    }
    async list() {
        try {
            const result=await this.run(this.binary,['-l']);
            const devices=parseDevices(result.stdout+'\n'+result.stderr,this.platform);
            let defaultName='System default';
            if(this.platform==='darwin')try {
                const raw=JSON.parse((await this.run('/usr/sbin/system_profiler',['SPAudioDataType','-json'])).stdout);
                defaultName=raw.SPAudioDataType?.flatMap(i=>i._items||[]).find(i=>i.coreaudio_default_audio_output_device==='spaudio_yes')?._name || defaultName;
            }catch { /* Enumeration still works if CoreAudio's friendly default name is unavailable. */ }
            if(!devices.some(d=>d.id==='default'))devices.unshift({id:'default',name:defaultName,platform:this.platform,systemDefault:true});
            let config,warning;
            try{config=await this.configuration();}catch{warning='Squeezelite service configuration is unavailable; device changes are disabled.';}
            const stored=this.getSettings().squeezeliteOutput;
            const saved=stored?.platform===this.platform ? stored : null;
            const selected=config && devices.find(d=>d.id===config.id || (d.index!=null && d.index===config.id));
            return {available:true,devices,current:selected || {id:config?.id || saved?.id || 'default',name:saved?.name || config?.id || defaultName,platform:this.platform},canChange:!!config,error:warning};
        }catch{return {available:false,devices:[],canChange:false,error:'Squeezelite audio outputs are unavailable on this host.'};}
    }
    async change(id) {
        if(this.changing)throw new Error('An audio output change is already in progress');
        this.changing=true;
        try {
            const available=await this.list();
            if(!available.canChange)throw new Error(available.error || 'Output changes are unavailable');
            const selected=available.devices.find(d=>d.id===id);
            if(!selected)throw new Error('Select a currently available Squeezelite output');
            if(this.platform==='linux'&&!/^[A-Za-z0-9:_,.=+-]+$/.test(id))throw new Error('Unsupported ALSA output identifier');
            const config=await this.configuration();
            if(config.id===id){this.setSetting('squeezeliteOutput',{id:selected.id,name:selected.name,platform:this.platform});return {success:true,current:selected,restarted:false};}
            const original=await this.files.readFile(this.config);
            const temporary=this.config+'.randy-tmp';
            const write=async value=>{await this.files.writeFile(temporary,value,{mode:0o644});await this.files.rename(temporary,this.config);};
            // Keep a recoverable copy before touching the existing service configuration.
            await this.files.writeFile(this.config+'.randy-backup',original,{mode:0o600});
            try {if(this.platform==='darwin') {
                const args=config.plist.ProgramArguments,position=args.indexOf('-o');
                if(position>=0)args[position+1]=id;else args.push('-o',id);
                await write(JSON.stringify(config.plist));
                await this.run('/usr/bin/plutil',['-convert','xml1',this.config]);
            } else {
                const value='SL_SOUNDCARD="'+id+'"';
                const text=/^SL_SOUNDCARD=.*$/m.test(config.text)?config.text.replace(/^SL_SOUNDCARD=.*$/m,value):config.text+'\n'+value+'\n';
                await write(text);
            }
            await this.restart();}
            catch(error) {
                await write(original);
                try{await this.restart();}catch{}
                throw new Error('Squeezelite output change failed; the previous configuration was restored');
            }
            this.setSetting('squeezeliteOutput',{id:selected.id,name:selected.name,platform:this.platform});
            return {success:true,current:selected,restarted:true};
        } finally {this.changing=false;}
    }
    async restart() {
        if(this.platform==='darwin') {
            const domain='gui/'+this.uid,job=domain+'/org.randy.squeezelite';
            let state;
            try{state=(await this.run('/bin/launchctl',['print',job])).stdout;}catch(error){if(!this.serviceWasUnloaded)throw error;}
            const before=state?.match(/\bpid = (\d+)/)?.[1];
            if(state){await this.run('/bin/launchctl',['bootout',job]);this.serviceWasUnloaded=true;}
            if(before) {
                let exited=false;
                for(let i=0;i<50;i++){try{await this.run('/bin/kill',['-0',before]);}catch{exited=true;break;}await this.wait(100);}
                if(!exited)throw new Error('Previous Squeezelite instance has not exited');
            }
            await this.run('/bin/launchctl',['bootstrap',domain,this.config]);
            this.serviceWasUnloaded=false;
            for(let i=0;i<30;i++) {
                const jobState=(await this.run('/bin/launchctl',['print',job])).stdout;
                if(/state = running/.test(jobState)&&/\bpid = \d+/.test(jobState))return;
                await this.wait(200);
            }
            throw new Error('Squeezelite did not start');
        } else await this.run('/usr/bin/systemctl',['restart','squeezelite.service']);
    }
}
module.exports={Output,parseDevices};
