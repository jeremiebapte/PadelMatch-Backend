// Weekly PADIMA marketing campaigns. Disabled by default until production validation.
export const MPG_CAMPAIGNS = Object.freeze([
  { key: "create_match", title: "Ton match attend qui ?", body: "Le terrain est prêt. Les joueurs ? Crée ta partie sur PADIMA et trouve ton quatrième." },
  { key: "join_match", title: "Le banc, c'est fini.", body: "Des parties cherchent des joueurs. Va voir sur PADIMA avant que les places partent." },
  { key: "create_group", title: "Ton WhatsApp est en PLS ?", body: "46 messages, zéro match. Crée ton groupe sur PADIMA et passe à l'action." },
  { key: "join_group", title: "Toujours sans équipe ?", body: "Rejoins un groupe PADIMA près de chez toi. Ton prochain match n'attend que toi." },
  { key: "invite_friends", title: "Tes potes jouent sans toi ?", body: "Invite-les sur PADIMA. Plus de joueurs, moins de galères pour remplir le terrain." },
]);

export function parisWeekKey(now = new Date()) {
  // ISO-like Monday week anchor, using calendar date in Paris.
  const parts = new Intl.DateTimeFormat("en-CA", { timeZone: "Europe/Paris", year: "numeric", month: "2-digit", day: "2-digit" }).formatToParts(now);
  const p = Object.fromEntries(parts.map(({ type, value }) => [type, value]));
  const date = new Date(Date.UTC(Number(p.year), Number(p.month) - 1, Number(p.day)));
  const mondayOffset = (date.getUTCDay() + 6) % 7;
  date.setUTCDate(date.getUTCDate() - mondayOffset);
  return date.toISOString().slice(0, 10);
}

export function campaignForWeek(weekKey) {
  const weeks = Math.floor(Date.parse(weekKey + "T00:00:00Z") / 604800000);
  return MPG_CAMPAIGNS[((weeks % MPG_CAMPAIGNS.length) + MPG_CAMPAIGNS.length) % MPG_CAMPAIGNS.length];
}

export function buildWeeklyMarketingPushCron({ db, messaging, tokensOf, isPushAllowed, logger, now = () => new Date() }) {
  return async () => {
    const weekKey = parisWeekKey(now());
    const config = await db.doc("adminConfig/weeklyMarketingPush").get();
    if (config.get("enabled") !== true) {
      logger.info("weekly MPG push disabled", { weekKey });
      return { skipped: "disabled" };
    }
    const campaign = campaignForWeek(weekKey);
    const ref = db.collection("marketingPushRuns").doc(weekKey);
    // create() is atomic: prevents duplicate sends, including concurrent scheduler retries.
    // A failed run is deliberately NOT auto-retried: manual review required.
    try {
      await ref.create({ status: "started", campaignKey: campaign.key, startedAt: now(), title: campaign.title, body: campaign.body });
    } catch (error) {
      if (error.code === 6 || error.code === "already-exists") return { skipped: "already_claimed" };
      throw error;
    }
    let checkedUsers = 0, eligibleTokens = 0, successCount = 0, failureCount = 0;
    try {
      const uniqueTokens = new Set();
      let last = null;
      while (true) {
        let query = db.collection("users").orderBy("__name__").limit(100);
        if (last) query = query.startAfter(last);
        const page = await query.get();
        if (page.empty) break;
        for (const user of page.docs) {
          checkedUsers++;
          try {
            if (!await isPushAllowed({ uid: user.id, category: "news", event: "marketing" })) continue;
            for (const token of await tokensOf(user.id)) uniqueTokens.add(token);
          } catch (error) {
            logger.warn("weekly MPG recipient skipped", { code: error.code || "unknown" });
          }
        }
        last = page.docs[page.docs.length - 1];
        if (page.size < 100) break;
      }
      const tokens = [...uniqueTokens];
      eligibleTokens = tokens.length;
      for (let i = 0; i < tokens.length; i += 500) {
        const response = await messaging.sendEachForMulticast({
          tokens: tokens.slice(i, i + 500),
          notification: { title: campaign.title, body: campaign.body },
          data: { type: "admin", subtype: "marketing", campaign: campaign.key },
        });
        successCount += response.successCount;
        failureCount += response.failureCount;
      }
      await ref.update({ status: "completed", completedAt: now(), checkedUsers, eligibleTokens, successCount, failureCount });
      logger.info("weekly MPG completed", { weekKey, checkedUsers, eligibleTokens, successCount, failureCount });
      return { weekKey, checkedUsers, eligibleTokens, successCount, failureCount };
    } catch (error) {
      await ref.update({ status: "failed", failedAt: now(), checkedUsers, eligibleTokens, successCount, failureCount, errorCode: String(error.code || "unknown") });
      throw error;
    }
  };
}
