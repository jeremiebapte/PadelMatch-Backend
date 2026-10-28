// Read-only Google Sheets authentication probe for Cloud Run / GCP runtimes.
// No JSON key, no spreadsheet writes, no token output.
const target = "1wFpGfWDU8D86J3XcwigQw6oUcz0S_liG3KiZhioiCPs";
export async function probeSheetsAccess({fetchImpl=fetch,token,spreadsheetId=target}={}) {
 if (!token) throw new Error("ACCESS_TOKEN_REQUIRED");
 const url="https://sheets.googleapis.com/v4/spreadsheets/"+encodeURIComponent(spreadsheetId)+"?fields=spreadsheetId%2Cproperties.title";
 const response=await fetchImpl(url,{headers:{Authorization:"Bearer "+token}});
 if(!response.ok) return {ok:false,status:response.status};
 const data=await response.json();
 return {ok:data.spreadsheetId===spreadsheetId,title:data.properties?.title||null};
}
export async function metadataAccessToken({fetchImpl=fetch}={}) {
 // Cloud Run metadata service. No user-provided token or stored credentials.
 const response=await fetchImpl("http://metadata.google.internal/computeMetadata/v1/instance/service-accounts/default/token",{headers:{"Metadata-Flavor":"Google"}});
 if(!response.ok) throw new Error("METADATA_TOKEN_UNAVAILABLE_"+response.status);
 const data=await response.json();
 if(!data.access_token) throw new Error("METADATA_TOKEN_EMPTY");
 return data.access_token;
}
