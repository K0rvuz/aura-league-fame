import { Pool } from "pg";
try{process.loadEnvFile(".env");}catch(e){if(!(e instanceof Error)||!("code" in e)||e.code!=="ENOENT")throw e;}
if(!process.env.DATABASE_URL){console.error("DATABASE_URL não configurada.");process.exit(1);}
const pool=new Pool({connectionString:process.env.DATABASE_URL,max:2,connectionTimeoutMillis:5000});
const [, ,cmd="stats"]=process.argv;
try{
  if(cmd==="stats"){
    const r=await pool.query("SELECT status,COUNT(*)::INT AS total FROM player_import_queue GROUP BY status ORDER BY status");
    console.table(r.rows);
  }else if(cmd==="list"){
    const r=await pool.query(`SELECT id,riot_id,region,status,attempts,result_name,last_error,created_at,processed_at
      FROM player_import_queue ORDER BY created_at DESC LIMIT 100`);
    console.table(r.rows);
  }else if(cmd==="pending"){
    const r=await pool.query(`SELECT id,riot_id,region,status,attempts,available_at,created_at
      FROM player_import_queue WHERE status IN ('pending','processing') ORDER BY created_at ASC LIMIT 100`);
    console.table(r.rows);
  }else{
    console.log("Uso:\n  npm run queue -- stats\n  npm run queue -- list\n  npm run queue -- pending");
    process.exitCode=1;
  }
}finally{await pool.end();}
