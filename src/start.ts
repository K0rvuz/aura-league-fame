import { createStart, createCsrfMiddleware, createMiddleware } from "@tanstack/react-start";
import { setResponseHeader } from "@tanstack/react-start/server";
import { renderErrorPage } from "./lib/error-page";
const errorMiddleware=createMiddleware().server(async({next})=>{
  try{return await next();}catch(error){
    if(error!=null&&typeof error==="object"&&"statusCode" in error) throw error;
    console.error(error);
    return new Response(renderErrorPage(),{status:500,headers:{"content-type":"text/html; charset=utf-8"}});
  }
});
const securityHeadersMiddleware=createMiddleware().server(async({next})=>{
  setResponseHeader("X-Content-Type-Options","nosniff");
  setResponseHeader("X-Frame-Options","DENY");
  setResponseHeader("Referrer-Policy","strict-origin-when-cross-origin");
  setResponseHeader("Permissions-Policy","camera=(), microphone=(), geolocation=()");
  setResponseHeader("Strict-Transport-Security","max-age=31536000");
  return next();
});
const csrfMiddleware=createCsrfMiddleware({filter:(ctx)=>ctx.handlerType==="serverFn"});
export const startInstance=createStart(()=>({requestMiddleware:[errorMiddleware,securityHeadersMiddleware,csrfMiddleware]}));
