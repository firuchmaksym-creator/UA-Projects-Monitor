import { clerkClient, getAuth } from "@clerk/express";
import type { RequestHandler } from "express";
import { logger } from "../lib/logger";

export const requireAdmin: RequestHandler = async (req, res, next): Promise<void> => {
  const { userId } = getAuth(req);
  if (!userId) {
    res.status(401).json({ error: "Sign-in required." });
    return;
  }

  const allowedEmails = (process.env.ADMIN_EMAIL ?? "")
    .split(",")
    .map((email) => email.trim().toLowerCase())
    .filter(Boolean);
  if (allowedEmails.length === 0) {
    res.status(403).json({ error: "Administrator access is not configured." });
    return;
  }

  try {
    const user = await clerkClient.users.getUser(userId);
    const userEmails = user.emailAddresses
      .filter((item) => item.verification?.status === "verified")
      .map((item) => item.emailAddress.toLowerCase());
    if (!userEmails.some((email) => allowedEmails.includes(email))) {
      res.status(403).json({ error: "Administrator access required." });
      return;
    }
    next();
  } catch (error) {
    logger.error({ err: error, userId }, "Could not verify admin user");
    res.status(503).json({ error: "Administrator access could not be verified." });
  }
};
