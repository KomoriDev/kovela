import assert from "node:assert/strict";
import {test} from "node:test";
import {readFile} from "node:fs/promises";
import {fileURLToPath} from "node:url";
import {getPlatformProxy} from "wrangler";
import {createWorker,type Env} from "../src/index";
import type {AfdianOrder} from "@kovela/afdian";

const product="com.komoridev.watermelon", buyer="b".repeat(32), other="d".repeat(32), plan="3187fe28c08a11f1805c52540025c377";
test("account skins entitlement uses only the bound Afdian account, rejects refunds and ignores old device bindings",async t=>{
  const platform=await getPlatformProxy<Env>({configPath:fileURLToPath(new URL("./wrangler.jsonc",import.meta.url)),persist:false,remoteBindings:false,envFiles:[]});
  t.after(()=>platform.dispose());const db=platform.env.DB;
  for(const migration of ["0001_initial.sql","0002_products.sql","0003_guides.sql","0004_buyer_entitlements.sql"]){
    const sql=await readFile(new URL("../migrations/"+migration,import.meta.url),"utf8");
    await db.batch(sql.split(";").map(v=>v.trim()).filter(Boolean).map(v=>db.prepare(v)));
  }
  const order:AfdianOrder={out_trade_no:"202610071234567890123456789",user_id:buyer,plan_id:plan,status:2,total_amount:"5.00"};
  const env:Env={DB:db,PUBLIC_ORIGIN:"http://127.0.0.1:5173",DEV_MODE:"true",PRODUCTS:[{productId:product,productName:"合成大西瓜图片自定义",purchaseUrl:"https://afdian.com/item/"+plan,planIds:[plan],skuIds:[]}],AFDIAN_USER_ID:"a".repeat(32),AFDIAN_TOKEN:"token",LICENSE_SIGNING_SEED:"",WEBHOOK_TOKEN:""};
  const worker=createWorker(async(input,init)=>{
    const params=JSON.parse(JSON.parse(String(init?.body)).params);
    if(String(input).endsWith("/query-order")){const params=JSON.parse(JSON.parse(String(init?.body)).params);return Response.json({ec:200,data:{list:params.out_trade_no===order.out_trade_no?[order]:[]}});}
    assert.ok(String(input).endsWith("/send-msg"));return Response.json({ec:200,data:{}});
  });
  let request=0;
  const post=async(body:unknown)=>{request++;const response=await worker.fetch(new Request(env.PUBLIC_ORIGIN+"/api/watermelon/entitlement",{method:"POST",headers:{"Content-Type":"application/json","CF-Connecting-IP":"127.0.0."+request},body:JSON.stringify(body)}),env);return {status:response.status,body:await response.json()};};
  assert.deepEqual((await post({afdianUserId:buyer})).body,{productId:product,afdianUserId:buyer,entitled:false});
  assert.equal((await post({afdianUserId:"bad"})).status,400);
  assert.equal((await post({afdianUserId:other})).body.entitled,false);
  assert.equal((await db.prepare("SELECT COUNT(*) AS n FROM purchases").first<{n:number}>())!.n,0);
  await db.prepare("INSERT INTO purchases(order_no,buyer_id,plan_id,payment_status,updated_at) VALUES(?,?,?,?,?)").bind(order.out_trade_no,buyer,plan,2,Date.now()).run();
  await db.prepare("INSERT INTO entitlements(license_id,order_no,product_id,product_name,state,updated_at) VALUES(?,?,?,?,?,?)").bind("l".repeat(32),order.out_trade_no,product,"合成大西瓜图片自定义","ready",Date.now()).run();
  assert.deepEqual((await post({afdianUserId:buyer.toUpperCase()})).body,{productId:product,afdianUserId:buyer,entitled:true});
  await db.prepare("UPDATE entitlements SET device_id=?,state='activated' WHERE product_id=?").bind("f".repeat(64),product).run();
  assert.deepEqual((await post({afdianUserId:buyer})).body,{productId:product,afdianUserId:buyer,entitled:true});
  assert.equal((await post({afdianUserId:other})).body.entitled,false);
  // 创作者本人无法在爱发电购买自己的商品：创作者账号直接放行。
  assert.deepEqual((await post({afdianUserId:env.AFDIAN_USER_ID})).body,{productId:product,afdianUserId:env.AFDIAN_USER_ID,entitled:true});
  assert.equal((await db.prepare("SELECT COUNT(*) AS n FROM sessions").first<{n:number}>())!.n,0);
  const oldLicense = await worker.fetch(new Request(env.PUBLIC_ORIGIN+"/api/activate",{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify({handoffToken:"a".repeat(64),deviceId:"f".repeat(64),productId:product,requestId:"legacy-license-request-0001"})}),{...env,LICENSE_SIGNING_SEED:"c".repeat(64)});
  assert.equal(oldLicense.status,409);
  assert.equal((await oldLicense.json()).error.code,"PLUGIN_ENTITLEMENT");
});
