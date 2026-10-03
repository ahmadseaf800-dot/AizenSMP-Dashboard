const http=require("http");
const fs=require("fs");
const path=require("path");

const root=__dirname;
const port=process.env.PORT||3000;
const apiToken=process.env.DASHBOARD_API_TOKEN||"";
const adminToken=process.env.DASHBOARD_ADMIN_TOKEN||apiToken;
const aizenAIUrl=String(process.env.AIZEN_AI_BUILDER_URL||"https://aizen-ai-builder.onrender.com").replace(/\/$/,"");
const aizenAISecret=String(process.env.AIZEN_DASHBOARD_SECRET||"");
const githubToken=String(process.env.GITHUB_TOKEN||"").trim();
const githubRepo=String(process.env.GITHUB_REPO||"ahmadseaf800-dot/AizenSMP").trim();
const githubWorkflow=String(process.env.GITHUB_WORKFLOW||"server.yml").trim();
const githubRef=String(process.env.GITHUB_REF||"main").trim();

const state={online:0,flags:0,kicks:0,bans:0,events:[],players:[],admins:[],servers:{},serverOnline:false,controlStatus:"OFFLINE",lastHeartbeat:null,commands:[],commandResults:[]};

function send(res,status,data,type="application/json"){
  res.writeHead(status,{"Content-Type":type,"Access-Control-Allow-Origin":"*","Cache-Control":"no-store","Access-Control-Allow-Headers":"Content-Type, Authorization","Access-Control-Allow-Methods":"GET,POST,OPTIONS"});
  if(Buffer.isBuffer(data)) return res.end(data);
  res.end(typeof data==="string"?data:JSON.stringify(data));
}
function addEvent(event){
  state.events.unshift({time:event.time||new Date().toISOString(),player:event.player||"Unknown",detection:event.detection||event.type||"Server",action:event.action||"Logged",reason:event.reason||"",duration:event.duration||""});
  state.events=state.events.slice(0,500);
}
function auth(req,token=apiToken){return !token||req.headers.authorization===`Bearer ${token}`;}
function secureAuth(req,token){return Boolean(token)&&req.headers.authorization===`Bearer ${token}`;}

function body(req){return new Promise((resolve,reject)=>{let raw="";req.on("data",c=>{raw+=c;if(raw.length>1024*1024)req.destroy();});req.on("end",()=>{try{resolve(JSON.parse(raw||"{}"))}catch(e){reject(e)}});req.on("error",reject);});}
function normalize(s){return String(s||"").toLowerCase().replace(/[إأآ]/g,"ا").replace(/[ة]/g,"ه").trim();}
function findPlayer(name){
  const n=normalize(name);
  const sources=[...(state.players||[]),...(state.admins||[]),...(state.events||[])];
  const p=sources.find(x=>normalize(x.player)===n);
  return p?p.player:"";
}
function queueCommand(command,source="AI"){
  const item={id:Date.now().toString(36)+Math.random().toString(36).slice(2,7),command:String(command),source,status:"queued",time:new Date().toISOString(),broadcast:false,claimedBy:[],completedBy:[]};
  state.commands.push(item);state.commands=state.commands.slice(-100);return item;
}
function rebuildAggregateState(){
  const now=Date.now();
  const activeServers=Object.values(state.servers||{}).filter(s=>s.lastHeartbeat&&now-Date.parse(s.lastHeartbeat)<30000);
  const playerMap=new Map();
  const adminMap=new Map();
  for(const server of activeServers){
    for(const p of (server.players||[])){
      const key=normalize(p.player);
      playerMap.set(key,{...p,server:server.name,status:p.status||"Online"});
    }
    for(const a of (server.admins||[])){
      const key=normalize(a.player);
      adminMap.set(key,{...a,server:server.name});
    }
  }
  state.players=[...playerMap.values()];
  state.admins=[...adminMap.values()];
  state.online=state.players.length;
  state.serverOnline=activeServers.length>0;
  if(activeServers.length>0) state.controlStatus="ONLINE";
  else if(!["STARTING","STOPPING","RESTARTING"].includes(state.controlStatus)) state.controlStatus="OFFLINE";
  state.lastHeartbeat=activeServers.sort((a,b)=>Date.parse(b.lastHeartbeat)-Date.parse(a.lastHeartbeat))[0]?.lastHeartbeat||null;
}

async function callAizenAI(message,snapshot=null){
  if(!aizenAISecret)throw new Error("AIZEN_DASHBOARD_SECRET is not configured");
  const payload=JSON.stringify({message,snapshot:snapshot||state});
  const candidates=[aizenAIUrl,"https://aizen-ai-builder.onrender.com"]
    .map(x=>String(x||"").replace(/\\/$/,""))
    .filter((x,i,a)=>x&&a.indexOf(x)===i);
  let lastError="AIZEN_AI_NOT_FOUND";
  for(const base of candidates){
    try{
      const r=await fetch(base+"/api/dashboard-ai",{
        method:"POST",
        headers:{"Content-Type":"application/json","x-aizen-dashboard-secret":aizenAISecret},
        body:payload
      });
      const raw=await r.text();
      let d={};
      try{d=JSON.parse(raw||"{}")}catch{}
      if(r.ok)return d;
      lastError=String(d.message||d.error||raw||("HTTP "+r.status)).trim();
      if(r.status!==404)break;
    }catch(err){
      lastError=String(err&&err.message||err);
    }
  }
  throw new Error("AIZEN AI endpoint unavailable: "+lastError);
}
async function githubApi(endpoint,options={}){
  if(!githubToken)throw new Error("GITHUB_TOKEN is not configured");
  const r=await fetch("https://api.github.com"+endpoint,{...options,headers:{"Accept":"application/vnd.github+json","Authorization":"Bearer "+githubToken,"X-GitHub-Api-Version":"2022-11-28",...(options.headers||{})}});
  const raw=await r.text();let data={};try{data=JSON.parse(raw)}catch{}
  if(!r.ok)throw new Error(data.message||("GitHub API HTTP "+r.status));
  return {status:r.status,data};
}
async function getWorkflowRuns(){
  const q="/repos/"+githubRepo+"/actions/workflows/"+encodeURIComponent(githubWorkflow)+"/runs?per_page=10&exclude_pull_requests=true";
  const out=await githubApi(q);
  const runs=Array.isArray(out.data.workflow_runs)?out.data.workflow_runs:[];
  const active=runs.filter(x=>["queued","in_progress","waiting","requested","pending"].includes(x.status));
  return {runs,active,latest:runs[0]||null};
}
async function getWorkflowDefinition(){
  const out=await githubApi("/repos/"+githubRepo+"/actions/workflows/"+encodeURIComponent(githubWorkflow));
  return out.data||{};
}
async function dispatchServer(){
  const workflow=await getWorkflowDefinition();
  const workflowId=workflow.id;
  if(!workflowId)throw new Error("GITHUB_WORKFLOW_NOT_FOUND");
  if(String(workflow.state||"").toLowerCase()!=="active")throw new Error("GITHUB_WORKFLOW_NOT_ACTIVE");
  try{
    return await githubApi("/repos/"+githubRepo+"/actions/workflows/"+encodeURIComponent(String(workflowId))+"/dispatches",{
      method:"POST",
      headers:{"Content-Type":"application/json"},
      body:JSON.stringify({ref:githubRef})
    });
  }catch(err){
    const msg=String(err&&err.message||"");
    if(/workflow does not have ['"]workflow_dispatch['"] trigger/i.test(msg)){
      return await githubApi("/repos/"+githubRepo+"/dispatches",{
        method:"POST",
        headers:{"Content-Type":"application/json"},
        body:JSON.stringify({
          event_type:"aizensmp_start",
          client_payload:{source:"aizen-smp-dashboard",ref:githubRef}
        })
      });
    }
    throw err;
  }
}
async function cancelActive(){
  const {active}=await getWorkflowRuns();
  for(const run of active)await githubApi("/repos/"+githubRepo+"/actions/runs/"+run.id+"/cancel",{method:"POST"});
  return active;
}
function buildMinecraftCommand(action,data){
  const target=findPlayer(data.target);
  const reason=String(data.reason||"AIZEN AI").trim().slice(0,200);
  const duration=String(data.duration||"").trim().slice(0,30);
  if(!target) throw new Error("PLAYER_NOT_FOUND_IN_DASHBOARD_DATA");
  if(action==="minecraft_op") return {command:"op "+target,broadcast:true};
  if(action==="minecraft_deop") return {command:"deop "+target,broadcast:true};
  if(action==="minecraft_ban") return {command:"ban "+target+" "+reason,broadcast:true};
  if(action==="minecraft_tempban"){
    if(!duration) throw new Error("BAN_DURATION_REQUIRED");
    return {command:"tempban "+target+" "+duration+" "+reason,broadcast:true};
  }
  if(action==="minecraft_pardon") return {command:"pardon "+target,broadcast:true};
  if(action==="minecraft_kick"){
    const online=state.players.some(p=>normalize(p.player)===normalize(target));
    if(!online) throw new Error("PLAYER_NOT_ONLINE");
    return {command:"kick "+target+" "+reason,broadcast:false};
  }
  if(action==="minecraft_role_add"||action==="minecraft_role_remove"){
    const role=String(data.role||"").trim();
    const actualRoles=[...new Set((state.admins||[]).map(x=>String(x.role||"").trim()).filter(Boolean))];
    if(!role||!actualRoles.some(x=>normalize(x)===normalize(role))) throw new Error("ROLE_NOT_PRESENT_IN_DASHBOARD_DATA");
    const actualRole=actualRoles.find(x=>normalize(x)===normalize(role))||role;
    const command=action==="minecraft_role_add"
      ?"lp user "+target+" parent set "+actualRole
      :"lp user "+target+" parent unset "+actualRole;
    return {command,broadcast:true};
  }
  throw new Error("UNSUPPORTED_MINECRAFT_ACTION");
}

async function serverAction(action){
  if(!["start","stop","restart"].includes(action))throw new Error("Invalid server action");
  const before=await getWorkflowRuns();
  if(action==="start"){
    if(before.active.length)return {action,status:"already-running",runId:before.active[0].id};
    await dispatchServer();
    state.controlStatus="STARTING";
    return {action,status:"starting"};
  }
  if(action==="stop"){
    const cancelled=await cancelActive();
    state.controlStatus=cancelled.length?"STOPPING":"OFFLINE";
    return {action,status:cancelled.length?"stopping":"already-stopped",cancelled:cancelled.map(x=>x.id)};
  }
  const cancelled=await cancelActive();
  for(let i=0;i<30;i++){
    await new Promise(r=>setTimeout(r,1000));
    const check=await getWorkflowRuns();
    if(!check.active.length)break;
  }
  await dispatchServer();
  return {action,status:"restarting",cancelled:cancelled.map(x=>x.id)};
}
function githubStatusPayload(info){
  const latest=info.latest,active=info.active[0]||null;
  return {configured:!!githubToken,repo:githubRepo,workflow:githubWorkflow,ref:githubRef,active:!!active,run:active||latest||null,runs:info.runs.slice(0,5).map(x=>({id:x.id,status:x.status,conclusion:x.conclusion,created_at:x.created_at,updated_at:x.updated_at,html_url:x.html_url}))};
}
function serveStatic(req,res){
  let pathname=new URL(req.url,"http://localhost").pathname;
  if(pathname==="/")pathname="/index.html";
  const file=path.normalize(path.join(root,pathname));
  if(!file.startsWith(root))return send(res,403,{error:"Forbidden"});
  fs.readFile(file,(err,data)=>{
    if(err)return send(res,404,{error:"Not found"});
    const ext=path.extname(file).toLowerCase();
    const types={".html":"text/html; charset=utf-8",".js":"text/javascript; charset=utf-8",".css":"text/css; charset=utf-8",".json":"application/json; charset=utf-8",".ico":"image/x-icon"};
    send(res,200,data,types[ext]||"application/octet-stream");
  });
}
const server=http.createServer(async(req,res)=>{
  if(req.method==="OPTIONS")return send(res,204,"");
  const url=new URL(req.url,"http://localhost");
  try{
    if(url.pathname==="/api/stats"&&req.method==="GET"){
      if(!secureAuth(req,adminToken))return send(res,401,{error:"Unauthorized"});
      rebuildAggregateState();
      return send(res,200,state);
    }
    if(url.pathname==="/api/event"&&req.method==="POST"){
      if(!secureAuth(req,apiToken))return send(res,401,{error:"Unauthorized"});
      const e=await body(req);
      if(e.type==="stats"){
        const serverName=String(e.server||"unknown").trim()||"unknown";
        state.servers[serverName]={name:serverName,online:Number(e.online||0),players:Array.isArray(e.players)?e.players:[],admins:Array.isArray(e.admins)?e.admins:[],lastHeartbeat:e.time||new Date().toISOString(),status:"ONLINE"};
        rebuildAggregateState();
      }
      else if(e.type==="flag"){state.flags++;addEvent(e);const p=findPlayer(e.player);const target=state.players.find(x=>normalize(x.player)===normalize(p));if(target){target.violations=Number(target.violations||0)+1;target.lastDetection=e.detection||"Security Flag";}}
      else if(e.type==="kick"){state.kicks++;addEvent(e);}
      else if(e.type==="ban"){state.bans++;addEvent(e);}
      else addEvent(e);
      return send(res,200,{ok:true});
    }
    if(url.pathname==="/api/commands"&&req.method==="GET"){
      if(!secureAuth(req,apiToken))return send(res,401,{error:"Unauthorized"});
      const serverName=String(url.searchParams.get("server")||"").trim();
      const activeServerNames=Object.values(state.servers||{})
        .filter(s=>s.lastHeartbeat&&Date.now()-Date.parse(s.lastHeartbeat)<30000)
        .map(s=>s.name);
      const queued=[];
      for(const x of state.commands){
        if(x.status!=="queued") continue;
        if(x.broadcast){
          if(!serverName || (x.claimedBy||[]).includes(serverName)) continue;
          x.claimedBy=Array.isArray(x.claimedBy)?x.claimedBy:[];
          x.claimedBy.push(serverName);
          if(activeServerNames.every(name=>x.claimedBy.includes(name))) x.status="sent";
          x.sentAt=x.sentAt||new Date().toISOString();
          queued.push(x);
        }else if(!x.targetServer || x.targetServer===serverName){
          x.status="sent";x.sentAt=new Date().toISOString();x.claimedBy=[serverName||"unknown"];
          queued.push(x);
        }
      }
      return send(res,200,{commands:queued,server:serverName});
    }
    if(url.pathname==="/api/command-result"&&req.method==="POST"){
      if(!secureAuth(req,apiToken))return send(res,401,{error:"Unauthorized"});
      const e=await body(req);
      const item=state.commands.find(x=>x.id===e.id);
      if(item){
        if(item.broadcast){
          item.completedBy=Array.isArray(item.completedBy)?item.completedBy:[];
          const server=String(e.server||"unknown");
          if(!item.completedBy.includes(server)) item.completedBy.push(server);
          const expected=(item.claimedBy||[]).length;
          if(!e.success) item.status="failed";
          else if(expected>0 && item.completedBy.length>=expected) item.status="completed";
        }else{
          item.status=e.success?"completed":"failed";
        }
      }
      state.commandResults.unshift({...e,time:new Date().toISOString()});
      state.commandResults=state.commandResults.slice(0,100);
      return send(res,200,{ok:true});
    }
    if(url.pathname==="/api/ai"&&req.method==="POST"){
      if(!secureAuth(req,adminToken))return send(res,401,{error:"Unauthorized"});
      const e=await body(req);
      if(!e.message)return send(res,400,{error:"message is required"});
      const out=await callAizenAI(String(e.message),state);
      let command=null;
      const action=String(out.action||"none");
      if(action==="server_start"||action==="server_stop"||action==="server_restart"){
        const result=await serverAction(action.replace("server_",""));
        return send(res,200,{reply:out.reply||"تمت معالجة العملية.",action,status:result.status,result});
      }
      if(action.startsWith("minecraft_")){
        const built=buildMinecraftCommand(action,out);
        command=queueCommand(built.command,"Aizen AI");
        command.target=out.target||"";
        command.reason=out.reason||"";
        command.duration=out.duration||"";
        command.targetServer=String(out.targetServer||"").trim();
        command.broadcast=Boolean(built.broadcast||out.broadcast);
      }
      return send(res,200,{reply:out.reply||"تمت المعالجة.",action,command});
    }
    if(url.pathname==="/api/github/status"&&req.method==="GET"){
      if(!secureAuth(req,adminToken))return send(res,401,{error:"Unauthorized"});
      if(!githubToken)return send(res,200,{configured:false,repo:githubRepo,workflow:githubWorkflow,ref:githubRef,active:false,run:null,runs:[]});
      const info=await getWorkflowRuns();
      if(info.active.length){
        if(state.controlStatus==="STOPPING") state.controlStatus="STOPPING";
        else if(state.controlStatus==="RESTARTING") state.controlStatus="RESTARTING";
        else state.controlStatus="STARTING";
      }else if(info.latest){
        if(["failure","cancelled","timed_out","action_required"].includes(String(info.latest.conclusion||"").toLowerCase())) state.controlStatus="OFFLINE";
        else if(state.controlStatus==="STOPPING") state.controlStatus="OFFLINE";
      }
      return send(res,200,githubStatusPayload(info));
    }
    if(url.pathname==="/api/server-action"&&req.method==="POST"){
      if(!auth(req,adminToken))return send(res,401,{error:"Unauthorized"});
      const e=await body(req);return send(res,200,{ok:true,...await serverAction(String(e.action||""))});
    }
    return serveStatic(req,res);
  }catch(err){console.error(err);return send(res,500,{error:err.message||"Internal server error"});}
});
server.listen(port,()=>console.log("AIZEN SMP Dashboard listening on "+port));
