# Weekly MPG marketing pushes

Cloud Function: `weeklyMarketingPushCron` — Tuesdays at 18:30 Europe/Paris.
**Do not enable before a test and production review.** The scheduled function was first deployed on 2026-11-23, initially disabled. Keep `enabled: false` until the corrected version is tested.

## Editorial workflow (you can submit ideas at any time)
In Firebase Console > Firestore, create `marketingPush/config/messages/<id>`:
- `title` (string, <=45 chars)
- `body` (string, <=110 chars)
- `status` (string): `idea` for suggestions, `approved` only after review
- `active` (boolean): true for eligible messages
- `order` (number): ordering in rotation

Ideas with status `idea` or `draft` **cannot be sent**. Edit the text and set
`status: approved` to include it in the weekly rotation. This can later be
exposed through an admin-only editor, but no client-side write permission is added.

Suggested starter copy (review before approval):
1. title: "Ton groupe WhatsApp est en PLS ?" / body: "46 messages, toujours pas de match. Crée ton groupe sur PADIMA, champion."
2. title: "Un terrain. Trois joueurs. Et toi ?" / body: "Arrête de scroller, rejoins une partie sur PADIMA."
3. title: "Tes potes jouent sans toi ?" / body: "Invite-les sur PADIMA. Au moins, tu sauras quand ils organisent un match."
4. title: "Le padel, c'est à quatre." / body: "Il manque un joueur ? Crée ton match et laisse PADIMA faire le reste."
5. title: "Ton prochain match t'attend." / body: "Rejoins un groupe de joueurs près de chez toi et fais tourner la balle."

## Configuration
Create `marketingPush/config`:
```json
{"enabled": false, "dryRun": true, "audience": "all"}
```
The absence of this document disables sends. Use `audience: test` with a valid `testUid` for controlled testing; `audience: all` targets eligible users.
First, approve messages, set `enabled: true` while keeping `dryRun: true`,
then check logs. For real sends, change `dryRun: false` only after explicit approval.

## Safety
- Existing marketing preference gate and per-user notificationsEnabled check reused.
- Per-ISO-week delivery claim prevents duplicate sending, including retry after partial failure.
- Any failed or partial campaign requires manual review; do not delete its delivery record blindly.
- Results stored in `marketingPush/config/deliveries/YYYY-Www`.
- A scheduler may run but does nothing when disabled. The curated copy library is used when no approved Firestore messages exist.
- Counts represent FCM acceptance, not confirmed device delivery.
- Current copy has no unverified deep link.

## Validation
Run `node --check functions/index.js` and `node --check functions/weeklyMarketingPush.js`.
Test with a dedicated staging Firebase project or controlled recipient list before enabling
the all-users campaign. For a controlled test use `audience: test` and `testUid` with `dryRun: true` first.

## Editorial policy update
The eight reviewed messages in `functions/weeklyMarketingCopy.js` are the **default** weekly rotation. No Firestore messages need to be created for normal weekly operation.

Occasional timely ideas can be sent to the founder's assistant in natural language, rewritten and reviewed, then added to `marketingPush/config/messages` with `status: approved` and `active: true` for a future scheduled slot. When at least one approved Firestore message exists, that queue temporarily takes priority over the evergreen library. Archive the timely message after its scheduled use to resume the library. The assistant conversation alone does **not** publish a message or send a push; a deliberate write to Firestore and an enabled production scheduler are required.

Avoid claims about current events unless checked at time of approval. Never send an unverified breaking-news claim.
