import { initializeApp } from "firebase/app";
import { getFunctions, httpsCallable } from "firebase/functions";

const firebaseConfig = {
  apiKey: "AIzaSyAVfCPOq8S8p6neUP0jWlyhSdnuHA8khxA",
  authDomain: "padelmatch-32186.firebaseapp.com",
  projectId: "padelmatch-32186",
  appId: "1:407285381717:web:3ea63d89953a42b17372dc",
};

const REGION = "europe-west1";

async function main() {
  const app = initializeApp(firebaseConfig);
  const functions = getFunctions(app, REGION);

  const fn = httpsCallable(functions, "broadcastMarketing");

  const res = await fn({
    adminKey: "adminKey0972",
    // optionnel :
    // title: "🎾 Les vacances arrivent",
    // body: "Plus d’excuses. Les terrains se remplissent vite. Crée ou rejoins ton match sur PadelMatch maintenant.",
    // deeplink: "padelmatch://home",
  });

  console.log("✅ Response:", res.data);
}

main().catch((e) => {
  console.error("❌ Error:", e?.message || e);
  if (e?.code) console.error("code:", e.code);
  if (e?.details) console.error("details:", e.details);
  process.exit(1);
});

