// Safe by default: no network access or writes without --write.
import {initializeApp,applicationDefault,deleteApp} from "firebase-admin/app";
import {getFirestore} from "firebase-admin/firestore";
import {createSheetsClient} from "../domain/metrics/SheetsRestClientV1.js";
import {planSync,applySyncPlan} from "../domain/metrics/GoogleSheetsMetricsSyncV1.js";
const write=process.argv.includes("--write");
const today=new Date();
const monday=new Date(Date.UTC(today.getUTCFullYear(),today.getUTCMonth(),today.getUTCDate()-((today.getUTCDay()+6)%7)));
const weekStart=process.env.PADIMA_METRICS_WEEK_START || monday.toISOString().slice(0,10);
if(!write) {
 console.log(JSON.stringify({mode:"dry-run",weekStart,firestore:"not contacted",sheets:"not contacted",status:"configuration only"}));
 process.exit(0);
}
if(process.env.PADIMA_METRICS_ALLOW_WRITE!=="yes" || !process.env.GOOGLE_OAUTH_ACCESS_TOKEN || !process.env.GOOGLE_CLOUD_PROJECT) throw Error("EXPLICIT_WRITE_AUTH_REQUIRED");
const app=initializeApp({credential:applicationDefault(),projectId:process.env.GOOGLE_CLOUD_PROJECT});
try {
 const plan=await planSync({db:getFirestore(app),weekStart});
 if(plan.status==="no_data") {console.log("SKIPPED: no Firestore metrics available");process.exitCode=0;}
 else {
  const sheets=createSheetsClient({accessToken:process.env.GOOGLE_OAUTH_ACCESS_TOKEN});
  const result=await applySyncPlan({sheets,plan});
  console.log(JSON.stringify({status:result.status,weekStart,metrics:"backend only"}));
 }
} finally {await deleteApp(app);}
