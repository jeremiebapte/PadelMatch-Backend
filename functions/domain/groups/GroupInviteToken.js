import crypto from "node:crypto";

import { GROUP_INVITE_TOKEN_BYTES } from "./GroupConstants.js";
import { validateInviteToken } from "./GroupInviteValidator.js";

export class GroupInviteTokenError extends Error {
  constructor(code, message = code) {
    super(message);
    this.name = "GroupInviteTokenError";
    this.code = code;
  }
}

export function generateInviteToken() {
  return crypto
    .randomBytes(GROUP_INVITE_TOKEN_BYTES)
    .toString("base64url");
}

export function hashInviteToken(token) {
  const validatedToken = validateInviteToken(token);

  return crypto
    .createHash("sha256")
    .update(validatedToken, "utf8")
    .digest("hex");
}

export function buildInviteUrl({
  token,
  baseUrl = "https://padima.app/invite",
}) {
  const validatedToken = validateInviteToken(token);

  let url;
  try {
    url = new URL(baseUrl);
  } catch {
    throw new GroupInviteTokenError("INVALID_INVITE_BASE_URL");
  }

  if (url.protocol !== "https:") {
    throw new GroupInviteTokenError("INVITE_URL_MUST_USE_HTTPS");
  }

  url.searchParams.set("token", validatedToken);
  return url.toString();
}
