import { createServer as createHttpServer } from 'node:http';
import { createReadStream, existsSync, statSync } from 'node:fs';
import { extname, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import { randomBytes } from 'node:crypto';
import {
  AppError, openDatabase, getUserById, createSession, getSessionUser, revokeSession,
  isSellerMember, getPilotStoreId, listStores, getProducts, getProduct, getSellerProducts, getSellerStores, updateStore, getPickupSlots,
  getCurrentStoreDate, getShopperOrder, getShopperOrders, getOrderStoreId, getSellerOrders,
  getPickupSettings, updatePickupSettings, createOrder, cancelOrder, transitionSellerOrder,
  getShopperProfile, updateShopperProfile, getShopperBasket, putShopperBasket,
  getSavedProducts, saveShopperProduct, unsaveShopperProduct,
  createProduct, patchProduct, resetDemo
} from './db.js';

const ROOT = resolve(fileURLToPath(new URL('..', import.meta.url)));
const PUBLIC = resolve(ROOT, 'public');
const MAX_BODY = 1024 * 1024;
const SESSION_COOKIE = 'kc_session';
const SESSION_SECONDS = 12 * 60 * 60;
const MIME = {
  '.html': 'text/html; charset=utf-8', '.css': 'text/css; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8', '.svg': 'image/svg+xml', '.webmanifest': 'application/manifest+json'
};

function sendJson(response,status,data) {
  response.writeHead(status,{
    'content-type':'application/json; charset=utf-8','cache-control':'no-store',
    'x-content-type-options':'nosniff','referrer-policy':'same-origin',
    'content-security-policy':"default-src 'self'; img-src 'self' data:; style-src 'self'; script-src 'self'; connect-src 'self'; base-uri 'none'; frame-ancestors 'none'"
  });
  response.end(JSON.stringify(data));
}
function sendError(response,error) {
  const status=error instanceof AppError?error.status:500;
  if(status===500)console.error(error);
  sendJson(response,status,{code:error.code||'INTERNAL_ERROR',message:status===500?'Something went wrong. Try again.':error.message,
    ...(error.details===undefined?{}:{details:error.details})});
}
async function readJson(request) {
  let raw='';
  for await(const chunk of request){raw+=chunk;if(Buffer.byteLength(raw)>MAX_BODY)throw new AppError(413,'BODY_TOO_LARGE','Request body is too large.');}
  if(!raw.trim())return {};
  try{return JSON.parse(raw);}catch{throw new AppError(400,'INVALID_JSON','Request body must be valid JSON.');}
}
function cookieValue(request,name) {
  for(const part of (request.headers.cookie||'').split(';')){
    const [key,...rest]=part.trim().split('=');
    if(key===name){try{return decodeURIComponent(rest.join('='));}catch{return '';}}
  }
  return '';
}
function setSessionCookie(response,token) {
  const secure=process.env.NODE_ENV==='production'||process.env.KIRANA_COOKIE_SECURE==='true'?'; Secure':'';
  response.setHeader('set-cookie',`${SESSION_COOKIE}=${encodeURIComponent(token)}; HttpOnly; SameSite=Strict; Path=/; Max-Age=${SESSION_SECONDS}${secure}`);
}
function clearSessionCookie(response) {
  const secure=process.env.NODE_ENV==='production'||process.env.KIRANA_COOKIE_SECURE==='true'?'; Secure':'';
  response.setHeader('set-cookie',`${SESSION_COOKIE}=; HttpOnly; SameSite=Strict; Path=/; Max-Age=0${secure}`);
}
function requireUser(db,request,role='') {
  const user=getSessionUser(db,cookieValue(request,SESSION_COOKIE));
  if(!user)throw new AppError(401,'AUTH_REQUIRED','Choose a sample account to continue.');
  if(role&&user.role!==role)throw new AppError(403,'ROLE_FORBIDDEN','This action is not available for your account.');
  return user;
}
function requireSellerStore(db,user,storeId) {
  if(user.role!=='seller'||!isSellerMember(db,user.id,storeId))throw new AppError(403,'STORE_ACCESS_DENIED','You do not have access to this shop.');
}
function requireSameOrigin(request) {
  const origin=request.headers.origin;
  if(!origin)return;
  const host=request.headers.host;
  let parsed;
  try{parsed=new URL(origin);}catch{throw new AppError(403,'ORIGIN_FORBIDDEN','Request origin is not allowed.');}
  if(!host||parsed.host!==host)throw new AppError(403,'ORIGIN_FORBIDDEN','Request origin is not allowed.');
}
function validateDate(value,fallback) {
  const date=String(value||fallback);
  if(!/^\d{4}-\d{2}-\d{2}$/.test(date)||Number.isNaN(Date.parse(`${date}T12:00:00Z`))||new Date(`${date}T12:00:00Z`).toISOString().slice(0,10)!==date)
    throw new AppError(400,'INVALID_DATE','Date must use YYYY-MM-DD.');
  return date;
}
function staticFile(response,request,path) {
  const route=path==='/'||path==='/customer'||path==='/seller'?'/index.html':path;
  const target=resolve(PUBLIC,`.${route}`);
  if(!target.startsWith(PUBLIC+sep)&&target!==resolve(PUBLIC,'index.html'))throw new AppError(404,'NOT_FOUND','Not found.');
  if(!existsSync(target)||!statSync(target).isFile())throw new AppError(404,'NOT_FOUND','Not found.');
  response.writeHead(200,{
    'content-type':MIME[extname(target)]||'application/octet-stream','x-content-type-options':'nosniff',
    'referrer-policy':'same-origin',
    'content-security-policy':"default-src 'self'; img-src 'self' data:; style-src 'self'; script-src 'self'; connect-src 'self'; base-uri 'none'; frame-ancestors 'none'"
  });
  if(request.method==='HEAD'){response.end();return;}
  createReadStream(target).pipe(response);
}
function decodePath(value) { try{return decodeURIComponent(value);}catch{throw new AppError(400,'INVALID_PATH','Path is not valid.');} }

export function createAppServer({dbPath=process.env.KIRANA_DB_PATH||resolve(ROOT,'data/kirana.sqlite')}={}) {
  const db=openDatabase(dbPath);
  const server=createHttpServer(async(request,response)=>{
    try{
      const url=new URL(request.url||'/',`http://${request.headers.host||'localhost'}`);
      const method=request.method||'GET';const path=url.pathname;
      if(['POST','PUT','PATCH','DELETE'].includes(method))requireSameOrigin(request);
      if(path.startsWith('/api/v1/')){
        if(method==='GET'&&path==='/api/v1/auth/session'){
          const user=getSessionUser(db,cookieValue(request,SESSION_COOKIE));
          sendJson(response,200,{user,demo_available:process.env.NODE_ENV!=='production'});return;
        }
        if(method==='POST'&&path==='/api/v1/auth/demo'){
          if(process.env.NODE_ENV==='production')throw new AppError(404,'NOT_FOUND','Not found.');
          const body=await readJson(request),role=String(body.role||'');
          if(!['shopper','seller'].includes(role))throw new AppError(400,'INVALID_ROLE','Choose shopper or shopkeeper.');
          const userId=role==='seller'?'demo-seller':'demo-shopper';
          const token=randomBytes(32).toString('base64url');const {user}=createSession(db,userId,token);setSessionCookie(response,token);
          sendJson(response,200,{user,demo:true});return;
        }
        if(method==='POST'&&path==='/api/v1/auth/logout'){
          revokeSession(db,cookieValue(request,SESSION_COOKIE));clearSessionCookie(response);sendJson(response,200,{ok:true});return;
        }
        if(method==='GET'&&path==='/api/v1/stores'){sendJson(response,200,{stores:listStores(db,{q:url.searchParams.get('q')||''})});return;}
        const productsMatch=path.match(/^\/api\/v1\/stores\/([^/]+)\/products$/);
        if(method==='GET'&&productsMatch){
          const storeId=decodePath(productsMatch[1]);
          sendJson(response,200,{products:getProducts(db,storeId,{q:url.searchParams.get('q')||'',category:url.searchParams.get('category')||'',
            inStock:url.searchParams.get('in_stock')||'',minPrice:url.searchParams.get('min_price')||'',maxPrice:url.searchParams.get('max_price')||'',sort:url.searchParams.get('sort')||''})});return;
        }
        const productMatch=path.match(/^\/api\/v1\/stores\/([^/]+)\/products\/([^/]+)$/);
        if(method==='GET'&&productMatch){sendJson(response,200,{product:getProduct(db,decodePath(productMatch[1]),decodePath(productMatch[2]))});return;}
        const slotsMatch=path.match(/^\/api\/v1\/stores\/([^/]+)\/pickup-slots$/);
        if(method==='GET'&&slotsMatch){
          const storeId=decodePath(slotsMatch[1]);const date=validateDate(url.searchParams.get('date'),getCurrentStoreDate(db,storeId));
          sendJson(response,200,{slots:getPickupSlots(db,storeId,date)});return;
        }
        if(method==='POST'&&path==='/api/v1/orders'){
          const shopper=requireUser(db,request,'shopper');const body=await readJson(request);
          const order=createOrder(db,{shopperId:shopper.id,storeId:body.store_id,slotId:body.slot_id,items:body.items,idempotencyKey:request.headers['idempotency-key']});
          sendJson(response,201,{order});return;
        }
        if(method==='GET'&&path==='/api/v1/shopper/me'){
          const shopper=requireUser(db,request,'shopper');sendJson(response,200,{profile:getShopperProfile(db,shopper.id)});return;
        }
        if(method==='PATCH'&&path==='/api/v1/shopper/me'){
          const shopper=requireUser(db,request,'shopper');sendJson(response,200,{profile:updateShopperProfile(db,shopper.id,await readJson(request))});return;
        }
        if(method==='GET'&&path==='/api/v1/shopper/basket'){
          const shopper=requireUser(db,request,'shopper');sendJson(response,200,{basket:getShopperBasket(db,shopper.id)});return;
        }
        if(method==='PUT'&&path==='/api/v1/shopper/basket'){
          const shopper=requireUser(db,request,'shopper'),body=await readJson(request);
          sendJson(response,200,{basket:putShopperBasket(db,shopper.id,{storeId:body.store_id,items:body.items})});return;
        }
        if(method==='GET'&&path==='/api/v1/shopper/me/orders'){
          const shopper=requireUser(db,request,'shopper');let orders=getShopperOrders(db,shopper.id);
          const status=url.searchParams.get('status')||'';
          if(status&&!['placed','packing','ready','collected','cancelled'].includes(status))throw new AppError(400,'INVALID_STATUS_FILTER','Order status filter is not valid.');
          if(status)orders=orders.filter(order=>order.status===status);
          sendJson(response,200,{orders});return;
        }
        if(method==='GET'&&path==='/api/v1/shopper/me/saved-products'){
          const shopper=requireUser(db,request,'shopper');sendJson(response,200,{products:getSavedProducts(db,shopper.id)});return;
        }
        const savedProduct=path.match(/^\/api\/v1\/shopper\/me\/saved-products\/([^/]+)$/);
        if(savedProduct&&method==='PUT'){
          const shopper=requireUser(db,request,'shopper');sendJson(response,200,{products:saveShopperProduct(db,shopper.id,decodePath(savedProduct[1]))});return;
        }
        if(savedProduct&&method==='DELETE'){
          const shopper=requireUser(db,request,'shopper');sendJson(response,200,{products:unsaveShopperProduct(db,shopper.id,decodePath(savedProduct[1]))});return;
        }
        if(method==='GET'&&path==='/api/v1/orders'){
          const shopper=requireUser(db,request,'shopper');sendJson(response,200,{orders:getShopperOrders(db,shopper.id)});return;
        }
        const shopperOrder=path.match(/^\/api\/v1\/orders\/([^/]+)$/);
        if(method==='GET'&&shopperOrder){
          const shopper=requireUser(db,request,'shopper');const order=getShopperOrder(db,decodePath(shopperOrder[1]),shopper.id);
          if(!order)throw new AppError(404,'ORDER_NOT_FOUND','Order not found.');sendJson(response,200,{order});return;
        }
        const cancelMatch=path.match(/^\/api\/v1\/orders\/([^/]+)\/cancel$/);
        if(method==='POST'&&cancelMatch){
          const user=requireUser(db,request),id=decodePath(cancelMatch[1]),body=await readJson(request);
          if(user.role==='seller'){
            const storeId=getOrderStoreId(db,id);if(!storeId)throw new AppError(404,'ORDER_NOT_FOUND','Order not found.');
            requireSellerStore(db,user,storeId);
          }
          const order=cancelOrder(db,id,{actorId:user.id,role:user.role,reason:body.reason||''});sendJson(response,200,{order});return;
        }
        if(method==='GET'&&path==='/api/v1/seller/stores'){
          const seller=requireUser(db,request,'seller');sendJson(response,200,{stores:getSellerStores(db,seller.id)});return;
        }
        const sellerStore=path.match(/^\/api\/v1\/seller\/stores\/([^/]+)$/);
        if(sellerStore&&method==='PATCH'){
          const seller=requireUser(db,request,'seller'),storeId=decodePath(sellerStore[1]);requireSellerStore(db,seller,storeId);
          sendJson(response,200,{store:updateStore(db,storeId,await readJson(request))});return;
        }
        const sellerProducts=path.match(/^\/api\/v1\/seller\/stores\/([^/]+)\/products$/);
        if(sellerProducts&&method==='GET'){
          const seller=requireUser(db,request,'seller'),storeId=decodePath(sellerProducts[1]);requireSellerStore(db,seller,storeId);
          sendJson(response,200,{products:getSellerProducts(db,storeId)});return;
        }
        if(sellerProducts&&method==='POST'){
          const seller=requireUser(db,request,'seller'),storeId=decodePath(sellerProducts[1]);requireSellerStore(db,seller,storeId);
          const product=createProduct(db,storeId,await readJson(request),{sellerId:seller.id});sendJson(response,201,{product});return;
        }
        const sellerProduct=path.match(/^\/api\/v1\/seller\/products\/([^/]+)$/);
        if(sellerProduct&&method==='PATCH'){
          const seller=requireUser(db,request,'seller');const product=patchProduct(db,decodePath(sellerProduct[1]),await readJson(request),{sellerId:seller.id});
          sendJson(response,200,{product});return;
        }
        const sellerOrders=path.match(/^\/api\/v1\/seller\/stores\/([^/]+)\/orders$/);
        if(sellerOrders&&method==='GET'){
          const seller=requireUser(db,request,'seller'),storeId=decodePath(sellerOrders[1]);requireSellerStore(db,seller,storeId);
          sendJson(response,200,{orders:getSellerOrders(db,storeId,{status:url.searchParams.get('status')||'',date:url.searchParams.get('date')||'',q:url.searchParams.get('q')||''})});return;
        }
        const pickupSettings=path.match(/^\/api\/v1\/seller\/stores\/([^/]+)\/pickup-settings$/);
        if(pickupSettings&&method==='GET'){
          const seller=requireUser(db,request,'seller'),storeId=decodePath(pickupSettings[1]);requireSellerStore(db,seller,storeId);
          sendJson(response,200,{settings:getPickupSettings(db,storeId)});return;
        }
        if(pickupSettings&&method==='PUT'){
          const seller=requireUser(db,request,'seller'),storeId=decodePath(pickupSettings[1]);requireSellerStore(db,seller,storeId);
          sendJson(response,200,{settings:updatePickupSettings(db,storeId,await readJson(request))});return;
        }
        const startPacking=path.match(/^\/api\/v1\/seller\/orders\/([^/]+)\/start-packing$/);
        if(startPacking&&method==='POST'){
          const seller=requireUser(db,request,'seller'),id=decodePath(startPacking[1]),storeId=getOrderStoreId(db,id);
          if(!storeId)throw new AppError(404,'ORDER_NOT_FOUND','Order not found.');
          const order=transitionSellerOrder(db,id,{actorId:seller.id,storeId,nextStatus:'packing'});sendJson(response,200,{order});return;
        }
        const markReady=path.match(/^\/api\/v1\/seller\/orders\/([^/]+)\/mark-ready$/);
        if(markReady&&method==='POST'){
          const seller=requireUser(db,request,'seller'),id=decodePath(markReady[1]),storeId=getOrderStoreId(db,id),body=await readJson(request);
          if(!storeId)throw new AppError(404,'ORDER_NOT_FOUND','Order not found.');
          const order=transitionSellerOrder(db,id,{actorId:seller.id,storeId,nextStatus:'ready',bagLabel:body.bag_label,pickupLocation:body.pickup_location});
          sendJson(response,200,{order});return;
        }
        const completePickup=path.match(/^\/api\/v1\/seller\/orders\/([^/]+)\/complete-pickup$/);
        if(completePickup&&method==='POST'){
          const seller=requireUser(db,request,'seller'),id=decodePath(completePickup[1]),storeId=getOrderStoreId(db,id),body=await readJson(request);
          if(!storeId)throw new AppError(404,'ORDER_NOT_FOUND','Order not found.');
          const order=transitionSellerOrder(db,id,{actorId:seller.id,storeId,nextStatus:'collected',pickupCode:body.pickup_code});
          sendJson(response,200,{order});return;
        }
        if(method==='POST'&&path==='/api/v1/demo/reset'){
          if(process.env.NODE_ENV==='production')throw new AppError(404,'NOT_FOUND','Not found.');
          const seller=requireUser(db,request,'seller');if(!isSellerMember(db,seller.id,getPilotStoreId()))throw new AppError(403,'STORE_ACCESS_DENIED','You do not have access to this shop.');
          resetDemo(db);sendJson(response,200,{ok:true});return;
        }
        throw new AppError(404,'NOT_FOUND','Not found.');
      }
      if(method!=='GET'&&method!=='HEAD')throw new AppError(405,'METHOD_NOT_ALLOWED','Method not allowed.');
      let decoded;try{decoded=decodeURIComponent(path);}catch{throw new AppError(400,'INVALID_PATH','Path is not valid.');}
      staticFile(response,request,decoded);
    }catch(error){sendError(response,error);}
  });
  server.on('close',()=>db.close());return server;
}

if(process.argv[1]&&resolve(process.argv[1])===fileURLToPath(import.meta.url)){
  if(process.env.NODE_ENV==='production')throw new Error('Production deployment is disabled until real shopper authentication and seller onboarding are implemented.');
  const server=createAppServer(),host=process.env.HOST||'127.0.0.1',port=Number(process.env.PORT||3000);
  server.listen(port,host,()=>console.log(`Kirana Corner listening at http://${host}:${port}`));
}
