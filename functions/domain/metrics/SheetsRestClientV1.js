// Keyless Sheets REST adapter. Token must be short-lived and supplied by trusted runtime.
// No token is logged, persisted or committed.
export function createSheetsClient({ accessToken, fetchImpl = fetch }) {
 if(typeof accessToken!=="string" || !accessToken) throw Error("GOOGLE_OAUTH_ACCESS_TOKEN_REQUIRED");
 const base="https://sheets.googleapis.com/v4/spreadsheets/";
 async function request(path,init={}) {
  const response=await fetchImpl(base+path,{...init,headers:{"Authorization":`Bearer ${accessToken}`,"Content-Type":"application/json"}});
  if(!response.ok) throw Error(`SHEETS_HTTP_${response.status}`);
  return response.json();
 }
 return {spreadsheets:{values:{
  get:async({spreadsheetId,range})=>({data:await request(encodeURIComponent(spreadsheetId)+"/values/"+encodeURIComponent(range))}),
  batchUpdate:async({spreadsheetId,requestBody})=>({data:await request(encodeURIComponent(spreadsheetId)+"/values:batchUpdate",{method:"POST",body:JSON.stringify(requestBody)})})
 }}};
}
