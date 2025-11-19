import * as functions from "firebase-functions/v2";
import * as logger from "firebase-functions/logger";
import * as admin from "firebase-admin";
import nodemailer from "nodemailer";
import { z } from "zod";

// --- Initialisation Firebase ---
try { admin.app(); } catch { admin.initializeApp(); }

// --- Validation des données reçues ---
const SupportSchema = z.object({
  subject: z.string().min(3).max(120),
  message: z.string().min(5).max(5000),
  fromEmail: z.string().email().optional(),
  fromUid: z.string().optional(),
  attachments: z.array(z.object({
    filename: z.string(),
    url: z.string().url()
  })).optional()
});

// --- Formatage du corps du mail ---
function formatBody(data: z.infer<typeof SupportSchema>, uid?: string) {
  const lines = [
    `Sujet: ${data.subject}`,
    `De: ${data.fromEmail ?? "inconnu"}`,
    `UID: ${data.fromUid ?? uid ?? "n/a"}`,
    "",
    data.message,
    "",
    data.attachments?.length
      ? `Pièces jointes (liens):\n${data.attachments.map(a => `- ${a.filename}: ${a.url}`).join("\n")}`
      : ""
  ].join("\n");

  const html = lines
    .replace(/\n/g, "<br>")
    .replace(/(https?:\/\/\S+)/g, '<a href="$1" target="_blank" rel="noreferrer">$1</a>');

  return { text: lines, html };
}

// --- Fonction principale : envoi du mail ---
export const sendSupportEmail = functions.https.onRequest(
  {
    region: "europe-west1",
    secrets: ["SMTP_PASSWORD", "SUPPORT_TO"], // secrets Firebase
    cors: true
  },
  async (req, res) => {
    try {
      if (req.method !== "POST") {
        res.status(405).send("Method Not Allowed");
        return;
      }

      // Vérifie l'auth utilisateur si un ID token est présent
      let uid: string | undefined = undefined;
      const authHeader = req.headers.authorization || "";
      if (authHeader.startsWith("Bearer ")) {
        const idToken = authHeader.substring("Bearer ".length);
        try {
          const decoded = await admin.auth().verifyIdToken(idToken);
          uid = decoded.uid;
        } catch {
          // On tolère si l'utilisateur n'est pas loggé
        }
      }

      // Validation du corps de la requête
      const parsed = SupportSchema.safeParse(req.body);
      if (!parsed.success) {
        res.status(400).json({ error: parsed.error.flatten() });
        return;
      }
      const data = parsed.data;

      // Transport SMTP OVH
      const transporter = nodemailer.createTransport({
        host: "ssl0.ovh.net",
        port: 465,
        secure: true,
        auth: {
          user: "contact@padel-match.app",
          pass: process.env.SMTP_PASSWORD as string,
        },
      });

      const toAddress =
        (process.env.SUPPORT_TO as string | undefined)?.trim() || "contact@padel-match.app";

      const { text, html } = formatBody(data, uid);
      const replyTo = data.fromEmail ?? "contact@padel-match.app";

      await transporter.sendMail({
        from: `"PadelMatch Support" <contact@padel-match.app>`,
        to: toAddress,
        subject: `[Support] ${data.subject}`,
        text,
        html,
        replyTo,
      });

      // Log Firestore (optionnel)
      await admin.firestore().collection("support_messages").add({
        createdAt: admin.firestore.FieldValue.serverTimestamp(),
        subject: data.subject,
        fromEmail: data.fromEmail ?? null,
        fromUid: data.fromUid ?? uid ?? null,
        message: data.message,
        attachments: data.attachments ?? [],
        status: "sent",
      });

      res.status(200).json({ ok: true });
    } catch (err: any) {
      logger.error("sendSupportEmail error", err);
      res.status(500).json({ ok: false, error: err?.message ?? "error" });
    }
  }
);
