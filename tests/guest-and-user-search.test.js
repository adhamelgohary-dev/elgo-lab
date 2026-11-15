"use strict";
const test=require('node:test'),assert=require('node:assert/strict');
const worker=require('../backend/worker'),{createEnv}=require('./helpers/d1-sqlite');
async function call(env,path,{body,token,cookie,method=body?'POST':'GET'}={}){
 const headers={};if(body)headers['Content-Type']='application/json';if(token)headers.Authorization='Bearer '+token;if(cookie)headers.Cookie=cookie;
 const response=await worker.handleApiRequest(new Request('https://elgo.test'+path,{method,headers,body:body?JSON.stringify(body):undefined}),env);
 return {status:response.status,data:await response.json(),response};
}
async function guest(env,name){const r=await call(env,'/api/auth/guest',{body:{username:name,isAdmin:true}});assert.equal(r.status,200,JSON.stringify(r.data));return r.data;}
async function master(env){const r=await call(env,'/api/admin/login',{body:{password:'correct horse battery staple'}});assert.equal(r.status,200);return r.response.headers.get('set-cookie').split(';')[0];}

test('progress sync keeps distinct composite mistake IDs and explicit resolution updates',async()=>{
 const env=createEnv(),g=await guest(env,'Notebook_Fixture');
 const first={internalId:'one::quiz::bank::q1',status:'unresolved'},second={internalId:'two::quiz::bank::q1',status:'unresolved'};
 const sync=items=>call(env,'/api/auth/sync-progress',{token:g.token,body:{progress:{mistakes:{schemaVersion:2,items}}}});
 assert.equal((await sync([first,second])).status,200);
 assert.equal((await sync([{...second,status:'resolved',resolvedAt:'2026-11-12T00:00:00Z'}])).status,200);
 const saved=JSON.parse(env.sqlite.prepare('SELECT progress_json FROM users WHERE student_id=?').get(g.profile.studentId).progress_json);
 assert.equal(saved.mistakes.items.length,2);assert.equal(saved.mistakes.items.find(m=>m.internalId===second.internalId).status,'resolved');
 assert.equal(saved.mistakes.items.find(m=>m.internalId===first.internalId).status,'unresolved');
});
test('guest name is explicit, unique, moderated and never grants an admin role',async()=>{
 const env=createEnv();assert.equal((await call(env,'/api/auth/guest',{body:{}})).status,400);
 assert.equal((await call(env,'/api/auth/guest',{body:{username:'admin'}})).status,400);
 const g=await guest(env,'Study_Guest');assert.equal(g.profile.username,'Study_Guest');assert.equal(g.profile.guest,true);assert.equal(g.profile.isAdmin,false);
 assert.equal(env.sqlite.prepare('SELECT password_hash FROM users').get().password_hash,'');
 assert.equal((await call(env,'/api/auth/guest',{body:{username:'study_guest'}})).status,409);
 const me=await call(env,'/api/auth/me',{token:g.token});assert.equal(me.data.profile.guest,true);
 assert.equal((await call(env,'/api/admin/users?q=Study',{token:g.token})).status,401);
});
test('only the authenticated guest can add a password and retain their identity/progress',async()=>{
 const env=createEnv(),g=await guest(env,'Learner_One');
 assert.equal((await call(env,'/api/auth/upgrade',{body:{password:'some-password-123',studentId:g.profile.studentId}})).status,401);
 assert.equal((await call(env,'/api/auth/claim',{body:{username:g.profile.username,studentId:g.profile.studentId,password:'some-password-123'}})).status,403);
 const r=await call(env,'/api/auth/upgrade',{token:g.token,body:{password:'some-password-123',progress:{bookmarks:[{questionId:'q1'}]}}});
 assert.equal(r.status,200,JSON.stringify(r.data));assert.equal(r.data.profile.studentId,g.profile.studentId);assert.equal(r.data.profile.guest,false);assert.equal(r.data.profile.progress.bookmarks.length,1);
 const login=await call(env,'/api/auth/login',{body:{username:g.profile.username,password:'some-password-123'}});assert.equal(login.status,200);assert.equal(login.data.profile.guest,false);
 assert.equal((await call(env,'/api/auth/upgrade',{token:g.token,body:{password:'new-password-234'}})).status,409);
});
test('admin search returns no default list, escapes wildcards and supports role/delete by matched result',async()=>{
 const env=createEnv(),a=await guest(env,'sara_one'),b=await guest(env,'saraXone'),cookie=await master(env);
 assert.deepEqual((await call(env,'/api/admin/users',{cookie})).data.users,[]);
 const result=await call(env,'/api/admin/users?q=sara_',{cookie});assert.equal(result.status,200,JSON.stringify(result.data));assert.deepEqual(result.data.users.map(u=>u.username),['sara_one']);
 const grant=await call(env,'/api/admin/users/role',{cookie,body:{studentId:a.profile.studentId,isAdmin:true}});assert.equal(grant.status,200);
 const noPrivilege=await call(env,'/api/admin/users/role',{token:b.token,body:{studentId:b.profile.studentId,isAdmin:true}});assert.equal(noPrivilege.status,403);
 const del=await call(env,'/api/admin/users/delete',{cookie,body:{studentId:a.profile.studentId}});assert.equal(del.status,200);
 assert.equal((await call(env,'/api/auth/me',{token:a.token})).status,401);
 assert.equal(env.sqlite.prepare('SELECT COUNT(*) AS n FROM users').get().n,1);
 assert.equal((await call(env,'/api/admin/users?q='+encodeURIComponent("' OR 1=1 --"),{cookie})).data.users.length,0);
});
test('admin search is capped at 20 matches and asks for a narrower query',async()=>{
 const env=createEnv();for(let i=0;i<24;i++)env.sqlite.prepare('INSERT INTO users(student_id,username,display_name) VALUES(?,?,?)').run('seed'+i,'SearchPerson'+i,'SearchPerson'+i);
 const result=await call(env,'/api/admin/users?q=Search',{cookie:await master(env)});assert.equal(result.data.users.length,20);assert.equal(result.data.hasMore,true);
});
test('admin Show All Users requires admin auth and lists users only when all=1 is requested',async()=>{
 const env=createEnv(),a=await guest(env,'Alpha_User'),b=await guest(env,'Beta_User');
 assert.equal((await call(env,'/api/admin/users?all=1',{token:a.token})).status,401);
 const cookie=await master(env);
 assert.deepEqual((await call(env,'/api/admin/users',{cookie})).data.users,[]);
 const allRes=await call(env,'/api/admin/users?all=1',{cookie});
 assert.equal(allRes.status,200);
 assert.deepEqual(allRes.data.users.map(u=>u.username),['Alpha_User','Beta_User']);
 assert.equal(b.profile.username,'Beta_User');
});
