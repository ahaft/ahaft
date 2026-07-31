import express from "express";
import ordersRouter from "./routes/orders.js";

const app = express();
app.use(express.json());
app.use("/api/orders", ordersRouter);

/** Service health check. */
app.get("/health", (_req, res) => {
  res.json({ ok: true });
});

app.listen(3000);
