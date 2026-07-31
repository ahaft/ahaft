import { Router } from "express";

const router = Router();

/** List orders, optionally filtered by status. */
router.get("/", (req, res) => {
  const status = req.query.status;
  res.json({ orders: [], status });
});

/** Get one order. */
router.get("/:orderId", (req, res) => {
  res.json({ id: req.params.orderId });
});

/** Charge the customer for an order. */
router.post("/:orderId/charge", (req, res) => {
  res.json(req.body);
});

export default router;
