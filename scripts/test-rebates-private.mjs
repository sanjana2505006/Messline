import {execFileSync} from "node:child_process";
import {mkdtempSync} from "node:fs";
import {tmpdir} from "node:os";
import path from "node:path";
import net from "node:net";
import {randomUUID} from "node:crypto";
import {fileURLToPath} from "node:url";
const root=path.resolve(path.dirname(fileURLToPath(import.meta.url)),"..");
const pg=process.env.PGBIN??(process.platform==="win32"?"C:/Program Files/PostgreSQL/18/bin":"");
const binary=name=>pg?path.join(pg,name+(process.platform==="win32"?".exe":"")):name;
const cluster=mkdtempSync(path.join(tmpdir(),"messline-rebates-private-"));
const listener=net.createServer();await new Promise((resolve,reject)=>{listener.once("error",reject);listener.listen(0,"127.0.0.1",resolve);});
const port=listener.address().port;await new Promise(resolve=>listener.close(resolve));
const url=`postgresql://rebates_test@127.0.0.1:${port}/rebates_private_test`,token=randomUUID();
const env={...process.env,DATABASE_URL:url,REBATE_TEST_DATABASE_URL:url,REBATE_TEST_ISOLATION:token};
const run=(file,args,options={})=>execFileSync(file,args,{cwd:root,env,stdio:"inherit",windowsHide:true,...options});
let started=false;
try{
 run(binary("initdb"),["-D",cluster,"-U","rebates_test","-A","trust","--no-locale","-E","UTF8"]);
 run(binary("pg_ctl"),["-D",cluster,"-l",path.join(cluster,"server.log"),"-o",`-h 127.0.0.1 -p ${port}`,"-w","start"]);started=true;
 run(binary("createdb"),["-h","127.0.0.1","-p",String(port),"-U","rebates_test","rebates_private_test"]);
 run(process.execPath,["node_modules/prisma/build/index.js","migrate","deploy"]);
 run(binary("psql"),[url,"-v","ON_ERROR_STOP=1","-c",`CREATE TABLE "_RebateTestIsolation" (token TEXT NOT NULL);INSERT INTO "_RebateTestIsolation" VALUES ('${token}');`]);
 run(process.execPath,["node_modules/tsx/dist/cli.mjs","--test","tests/rebates.integration.test.ts"]);
}finally{
 if(started)run(binary("pg_ctl"),["-D",cluster,"-m","fast","-w","stop"]);
 console.log(`Private PostgreSQL stopped; diagnostic files retained at ${cluster}`);
}
