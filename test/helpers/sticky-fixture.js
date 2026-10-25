'use strict';
const fs=require('node:fs'),path=require('node:path'),os=require('node:os'),vm=require('node:vm');
const {createRequire}=require('node:module');
const JSONdb=require('simple-json-db');
const filename=path.resolve(__dirname,'../../lib/playlist_utils.js'),requirePlaylist=createRequire(filename);
async function fixture(directory) {
    const root=directory || fs.mkdtempSync(path.join(os.tmpdir(),'randy-sticky-rename-'));
    if(!directory) {
        fs.writeFileSync(path.join(root,'ldb.json'),JSON.stringify({stickylist:[
            {name:'Kind of Blue',path:'/music/Miles Davis/Kind of Blue'},
            {name:'Radio',path:{path:'https://radio.example/live',id:'station-one',site:'https://radio.example'}},
            {name:'Track',source:'spotify',path:{type:'spotify',songfile:'spoton://track:3M0zi8iD2KRzY71XcGFUpE',tags:{common:{title:'Track',artist:'Artist'}}}}
        ]}));
        fs.writeFileSync(path.join(root,'pdb.json'),JSON.stringify({playlist:[{songfile:'/music/test.flac'}]}));
        fs.writeFileSync(path.join(root,'sdb.json'),JSON.stringify({status:{playing:0,volume:35}}));
        fs.writeFileSync(path.join(root,'odb.json'),JSON.stringify({settings:{musicfolders:null}}));
    }
    const dbs={};
    function DB(file){const db=new JSONdb(path.join(root,path.basename(file)));dbs[path.basename(file,'.json')]=db;return db;}
    const context=vm.createContext({module:{exports:{}},__dirname:path.dirname(filename),console:{log(){},error(){}},Buffer,URL,
        require:name=>name==='simple-json-db'?DB:requirePlaylist(name)});
    vm.runInContext(fs.readFileSync(filename,'utf8'),context);
    const playlist=context.module.exports,events={queue:0,sticky:0};
    await playlist.initPlaylist(()=>events.queue++,()=>events.sticky++,()=>{});
    await new Promise(r=>setImmediate(r));events.queue=events.sticky=0;
    return {root,playlist,events,dbs,context};
}
module.exports=fixture;
