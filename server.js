const http=require("http");
const fs=require("fs");
const path=require("path");

const root=__dirname;
const port=process.env.PORT||3000;
const apiToken=process.env.DASHBOARD_API_TOKEN||"";
const adminToken=process.env.DASHBOARD_ADMIN_TOKEN||apiToken;
const state={online:0,flags:0,kicks:0,bans:0,events:[],players:[],admins:[],serverOnline:false,lastHeartbeat:null,commands:[],commandResults:[]};

function send(res,status,data,type="application/json"){
  res.writeHead(status,{"Content-Type":type,"Access-Control-Allow-Origin":"*","Cache-Control":"no-store","Access-Control-Allow-Headers":"Content-Type, Authorization"});
  if(Buffer.isBuffer(data)) return res.end(data);
  res.end(typeof data==="string"?data:JSON.stringify(data));
}
function addEvent(event){
  state.events.unshift({time:event.time||new Date().toISOString(),player:event.player||"Unknown",detection:event.detection||event.type||"Server",action:event.action||"Logged",reason:event.reason||"",duration:event.duration||""});
  state.events=state.events.slice(0,500);
}
function auth(req,token=apiToken){return !token||req.headers.authorization===`Bearer ${token}`;}
function body(req){return new Promise((resolve,reject)=>{let raw="";req.on("data",c=>{raw+=c;if(raw.length>1024*1024)req.destroy();});req.on("end",()=>{try{resolve(JSON.parse(raw||"{}"))}catch(e){reject(e)}});req.on("error",reject);});}
function normalize(s){return String(s||"").toLowerCase().replace(/[إأآ]/g,"ا").replace(/[ة]/g,"ه").trim();}
function findPlayer(name){const n=normalize(name);const p=state.players.find(x=>normalize(x.player)===n);return p?p.player:String(name||"");}
function queueCommand(command,source="AI"){
  const item={id:Date.now().toString(36)+Math.random().toString(36).slice(2,7),command:String(command),source,status:"queued",time:new Date().toISOString()};
  state.commands.push(item);state.commands=state.commands.slice(-100);return item;
}
function ai(text){
  const t=normalize(text);
  const duration=(t.match(/(\d+)\s*(يوم|ايام|day|days)/)||[])[1];
  const reasonMatch=t.match(/(?:سبب|السبب|reason)\s+(.+?)(?=\s+(?:لمده|لمدة|مده|مدة|for)\b|$)/);
  const reason=reasonMatch?reasonMatch[1].trim():"";
  let m=t.match(/(?:اعطي|اعط|give)\s+([a-z0-9_\-]+)\s+(?:اوبي|op|operator)/);
  if(m)return {reply:"سأعطي "+m[1]+" OP.",command:"op "+m[1]};
  m=t.match(/(?:شيل|ازيل|ازل|remove|take)\s+(?:اوبي|op)\s+(?:من|عن)\s+([a-z0-9_\-]+)/);
  if(m)return {reply:"سأزيل OP من "+m[1]+".",command:"deop "+m[1]};
  m=t.match(/(?:بند|بان|ban)\s+([a-z0-9_\-]+)(?:\s+(?:لمده|لمدة|مده|مدة|for)\s+(\d+)\s*(?:يوم|ايام|day|days))?(?:\s+(?:سبب|السبب|reason)\s+(.+))?$/);
  if(m){const d=m[2]||duration;const r=m[3]||reason||"Admin action";if(d){const seconds=Number(d)*86400;return {reply:"سأبند "+m[1]+" لمدة "+d+" يوم. السبب: "+r,command:"tempban "+m[1]+" "+seconds+" "+r};}return {reply:"سأبند "+m[1]+" بشكل دائم. السبب: "+r,command:"ban "+m[1]+" "+r};}
  m=t.match(/(?:سبب|السبب|why)\s+(?:باند|بان|ban)\s+([a-z0-9_\-]+)/);
  if(m){const p=findPlayer(m[1]);const ev=state.events.find(x=>normalize(x.player)===normalize(p)&&String(x.action).toLowerCase().includes("ban"));return {reply:ev?"سبب باند "+p+": "+(ev.reason||"غير مسجل")+(ev.duration?" — المدة: "+ev.duration:""):"لا يوجد باند مسجل لهذا اللاعب.",command:null};}
  m=t.match(/(?:شغل|نفذ|execute|run)\s+(?:امر|أمر|command)\s+(.+)/);
  if(m)return {reply:"سأنفذ أمر السيرفر.",command:m[1].replace(/^\//,"")};
  m=t.match(/^(?:اعادة تشغيل|اعاده تشغيل|restart|restart server)$/);
  if(m)return {reply:"سأعيد تشغيل السيرفر.",command:"restart"};
  return {reply:"أقدر تنفيذ أوامر مثل: اعطي Aizen اوبي، بند احمد لمدة 3 ايام السبب هكر، ما سبب باند احمد، أو نفذ أمر <الأمر>.",command:null};
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
      if(e.type==="stats"){state.online=Number(e.online||0);if(Array.isArray(e.players))state.players=e.players.slice(0,500);if(Array.isArray(e.admins))state.admins=e.admins.slice(0,200);state.serverOnline=true;state.lastHeartbeat=e.time||new Date().toISOString();}
      else{if(e.type==="flag")state.flags++;if(e.type==="kick")state.kicks++;if(e.type==="ban")state.bans++;addEvent(e);if(e.player){const p=state.players.find(x=>x.player===e.player);if(p){p.lastDetection=e.detection||e.type;p.violations=Number(p.violations||0)+(e.type==="flag"?1:0);}}}
      return send(res,200,{ok:true});
    }catch(e){return send(res,400,{error:"Invalid JSON"});}
  }
  if(req.method==="GET"&&req.url==="/api/commands"){
    if(!auth(req))return send(res,401,{error:"Unauthorized"});
    const pending=state.commands.filter(x=>x.status==="queued").slice(0,20);
    pending.forEach(x=>x.status="sent");
    return send(res,200,{commands:pending});
  }
  if(req.method==="POST"&&req.url==="/api/command-result"){
    if(!auth(req))return send(res,401,{error:"Unauthorized"});
    try{const e=await body(req);const c=state.commands.find(x=>x.id===e.id);if(c){c.status=e.ok===false?"failed":"done";c.result=e.result||"";c.finishedAt=new Date().toISOString();}state.commandResults.unshift(e);state.commandResults=state.commandResults.slice(0,100);return send(res,200,{ok:true});}catch(e){return send(res,400,{error:"Invalid JSON"});}
  }
  if(req.method==="POST"&&req.url==="/api/ai"){
    if(!auth(req,adminToken))return send(res,401,{error:"Unauthorized"});
    try{const e=await body(req);const out=ai(e.message||"");let item=null;if(out.command)item=queueCommand(out.command,"AI");return send(res,200,{reply:out.reply,command:item});}catch(e){return send(res,400,{error:"Invalid JSON"});}
  }
  let f=req.url==="/"?"index.html":req.url.slice(1),file=path.join(root,f);
  if(!file.startsWith(root)||!fs.existsSync(file))return send(res,404,"Not found","text/plain");
  const ext=path.extname(file),type=ext===".html"?"text/html":ext===".js"?"text/javascript":ext===".json"?"application/json":"text/plain";
  return send(res,200,fs.readFileSync(file),type);
}).listen(port,()=>console.log("AIZEN Dashboard API running on "+port));