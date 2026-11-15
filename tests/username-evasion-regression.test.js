"use strict";
const test=require("node:test"),assert=require("node:assert/strict"),worker=require("../backend/worker"),moderation=require("../backend/username-moderation"),client=require("../src/core/online-client"),{createEnv}=require("./helpers/d1-sqlite");
test("moderation loading failure never falls back to a weaker acceptance policy",()=>{
  const fs=require('node:fs'),path=require('node:path'),vm=require('node:vm'),moduleBox={exports:{}};
  vm.runInNewContext(fs.readFileSync(path.join(__dirname,'../backend/worker.js'),'utf8'),{module:moduleBox,exports:moduleBox.exports,require:id=>{if(id==='./username-moderation.js')throw Error('Unavailable');return require(path.join(__dirname,'../backend',id));}});
  const result=moduleBox.exports.validateUsernameServer('Ahmed_2026');assert.equal(result.ok,false);assert.match(result.error,/temporarily unavailable/);
});
test("a legitimate first name cannot exempt an offensive neighboring token or counter suffix",()=>{
  const terms=["3ars","5ara","khol","khawal","5awal","zob","zobr","teezak","dick","cock","كس","خول"];
  const cases=terms.flatMap(t=>[t,t+"2026","ahmed_"+t,"ahmed_"+t+"123",t+"_omar","omar"+t,t+"ahmed","احمد_"+t]);
  for(const name of cases)assert.equal(worker.validateUsernameServer(name).ok,false,"Rejected evasion case");
  for(const name of ["ahmed3ars123","d1ck123","a7med_5awal","محمدخول","احمد_خ_و_ل","f\u061cuck","خ،ول","احمد_خ،ول"])assert.equal(moderation.checkModeration(name).ok,false);
});
test("normal Arabic and Franco names remain usable; display controls and unsupported symbols do not",()=>{
  for(const name of ["a7med","mo7amed","3omar","7assan","3ali","abdelra7man","mohamed_7assan","نُور_٢٠٢٦","أحمد_علي","Nicholas_Dickens","Kassab_2026","class2026","peacock_2004"]){assert.equal(worker.validateUsernameServer(name).ok,true,name);assert.equal(client.validateUsername(name).ok,true,name);}
  for(const name of ["ahmed\u061cali","ali\u200bnour","ali\u202enour","اسم،اخر","name★","name\u06dd","name\u2066"]){assert.equal(worker.validateUsernameServer(name).ok,false);assert.equal(client.validateUsername(name).ok,false);}
  assert.equal(worker.validateUsernameServer("Ａｈｍｅｄ_２０２６").username,"Ahmed_2026");
  assert.equal(worker.validateUsernameServer("ｆｕｃｋ").ok,false);
});
test("registration API enforces moderation before creating an account",async()=>{
  const env=createEnv();for(const username of ["ahmed_3ars","mohamed_5awal2026","name\u061cname"]){const response=await worker.handleApiRequest(new Request("http://x/api/auth/register",{method:"POST",headers:{"Content-Type":"application/json",Origin:"http://x"},body:JSON.stringify({username,password:"local-fixture-password"})}),env);assert.equal(response.status,400);}
  assert.equal(env.sqlite.prepare("SELECT COUNT(*) AS n FROM users").get().n,0);
});
