import type { Express } from "express";
import { sdk } from "./sdk";
import { getEvidenceByObjectKey } from "../repositories/investigations";
import { storageGetSignedUrl } from "../storage";

export function registerStorageProxy(app: Express) {
  app.get("/manus-storage/*", async (req, res) => {
    let user;
    try {
      user = await sdk.authenticateRequest(req);
    } catch {
      res.status(401).send("Authentication required");
      return;
    }
    const rawKey = req.path.replace(/^\/manus-storage\//, "").replace(/^\/+/, "");
    if (!rawKey || rawKey.includes("..")) {
      res.status(404).send("Object not found");
      return;
    }
    try {
      await getEvidenceByObjectKey(user.id, rawKey);
      const signedUrl = await storageGetSignedUrl(rawKey);
      res.redirect(307, signedUrl);
    } catch {
      // Do not reveal whether an object exists to callers without investigation access.
      res.status(404).send("Object not found");
    }
  });
}
