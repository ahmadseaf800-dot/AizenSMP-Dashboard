const http=require("http");
const fs=require("fs");
const path=require("path");

const root=__dirname;
const port=process.env.PORT||3000;
const apiToken=process.env.DASHBOARD_API_TOKEN||"";
const adminToken=process.env.DASHBOARD_ADMIN_TOKEN||apiToken;
const aizenAIUrl=String(process.env.AIZEN_AI_BUILDER_URL||"https://aizen-ai-builder.onrender.com").replace(/\\/$/,"");
const aizenAISecret=String(process.env.AIZEN_DASHBOARD_SECRET||"");
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
async function callAizenAI(message){
  if(!aizenAISecret)throw new Error("AIZEN_DASHBOARD_SECRET is not configured");
  const r=await fetch(aizenAIUrl+"/api/dashboard-ai",{method:"POST",headers:{"Content-Type":"application/json","x-aizen-dashboard-secret":aizenAISecret},body:JSON.stringify({message})});
  const d=await r.json().catch(()=>({}));
  if(!r.ok)throw new Error(d.message||d.error||"Aizen AI request failed");
  return d;
}
;