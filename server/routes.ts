import { Router, type Request, type Response, type NextFunction } from "express";
import { createSchema, idSchema, updateSchema } from "./validation.js";
import * as db from "./db.js";

// Express 5 forwards rejected promises to the error handler, this just keeps handlers short.
type Handler = (req: Request, res: Response, next: NextFunction) => Promise<unknown>;
const h = (fn: Handler) => fn;

export const transcriptionsRouter = Router();

transcriptionsRouter.get(
  "/",
  h(async (req, res) => {
    const q = typeof req.query.q === "string" ? req.query.q.trim() : "";
    res.json(await db.listTranscriptions(q || undefined));
  }),
);

transcriptionsRouter.get(
  "/:id",
  h(async (req, res) => {
    const id = idSchema.safeParse(req.params.id);
    if (!id.success) return res.status(400).json({ error: "Invalid id" });
    const row = await db.getTranscription(id.data);
    if (!row) return res.status(404).json({ error: "Not found" });
    res.json(row);
  }),
);

transcriptionsRouter.post(
  "/",
  h(async (req, res) => {
    const body = createSchema.safeParse(req.body);
    if (!body.success) return res.status(400).json({ error: body.error.issues[0]?.message });
    res.status(201).json(await db.createTranscription(body.data));
  }),
);

transcriptionsRouter.patch(
  "/:id",
  h(async (req, res) => {
    const id = idSchema.safeParse(req.params.id);
    if (!id.success) return res.status(400).json({ error: "Invalid id" });
    const body = updateSchema.safeParse(req.body);
    if (!body.success) return res.status(400).json({ error: body.error.issues[0]?.message });
    const row = await db.updateTranscription(id.data, body.data);
    if (!row) return res.status(404).json({ error: "Not found" });
    res.json(row);
  }),
);

transcriptionsRouter.delete(
  "/:id",
  h(async (req, res) => {
    const id = idSchema.safeParse(req.params.id);
    if (!id.success) return res.status(400).json({ error: "Invalid id" });
    const ok = await db.deleteTranscription(id.data);
    if (!ok) return res.status(404).json({ error: "Not found" });
    res.status(204).end();
  }),
);
