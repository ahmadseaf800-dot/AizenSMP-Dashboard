const http=require("http");
const fs=require("fs");
const path=require("path");

const root=__dirname;
const port=process.env.PORT||3000;
const apiToken=process.env.DASHBOARD_API_TOKEN||"";
const state={online:0,flags:0,kicks:0,bans:0,events:[],players:[],serverOnline:false,lastHeartbeat:null};

function send(res,status,data,type="application/json"){
  res.writeHead(status,{"Content-Type":type,"Access-Control-Allow-Origin":"*","Cache-Control":"no-store"});
  if(Buffer.isBuffer(data)) return res.end(data);
  res.end(typeof data==="string"?data:JSON.stringify(data));
}
function addEvent(event){
  state.events.unshift({
    time:event.time||new Date().toISOString(),
    player:event.player||"Unknown",
    detection:event.detection||event.type||"Server",
    action:event.action||"Logged",
    reason:event.reason||""
  });
  state.events=state.events.slice(0,500);
}
function auth(req){
  return !apiToken || req.headers.authorization===`Bearer ${apiToken}`;
}
function body(req){
  return new Promise((resolve,reject)=>{
    let raw="";
    req.on("data",c=>{raw+=c;if(raw.length>1024*1024)req.destroy();});
    req.on("end",()=>{try{resolve(JSON.parse(raw||"{}"))}catch(e){reject(e)}});
    req.on("error",reject);
  });
}
http.createServer(async(req,res)=>{
  if(req.method==="OPTIONS"){res.writeHead(204,{"Access-Control-Allow-Origin":"*","Access-Control-Allow-Headers":"Content-Type, Authorization"});return res.end();}
  if(req.method==="GET"&&req.url==="/api/stats"){
    const heartbeat=state.lastHeartbeat?Date.now()-new Date(state.lastHeartbeat).getTime():Infinity;
    state.serverOnline=heartbeat<30000;
    if(!state.serverOnline){state.online=0;state.players=[];}
    return send(res,200,state);
  }
  if(req.method==="POST"&&req.url==="/api/event"){
    if(!auth(req))return send(res,401,{error:"Unauthorized"});
    try{
      const e=await body(req);
      if(e.type==="stats"){
        state.online=Number(e.online||0);
        if(Array.isArray(e.players))state.players=e.players.slice(0,500);
        state.serverOnline=true;
        state.lastHeartbeat=e.time||new Date().toISOString();
      }else{
        if(e.type==="flag")state.flags++;
        if(e.type==="kick")state.kicks++;
        if(e.type==="ban")state.bans++;
        addEvent(e);
        if(e.player){
          const p=state.players.find(x=>x.player===e.player);
          if(p){p.lastDetection=e.detection||e.type;p.violations=Number(p.violations||0)+(e.type==="flag"?1:0);}
        }
      }
      return send(res,200,{ok:true});
    }catch(e){return send(res,400,{error:"Invalid JSON"});}
  }
  let f=req.url==="/"?"index.html":req.url.slice(1);
  let file=path.join(root,f);
  if(!file.startsWith(root)||!fs.existsSync(file))return send(res,404,"Not found","text/plain");
  const ext=path.extname(file);
  const type=ext===".html"?"text/html":ext===".js"?"text/javascript":ext===".json"?"application/json":"text/plain";
  return send(res,200,fs.readFileSync(file),type);
}).listen(port,()=>console.log("AIZEN Dashboard API running on "+port));