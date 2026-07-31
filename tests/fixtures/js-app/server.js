const express = require("express");

const app = express();
app.use(express.json());

/**
 * List all widgets in the catalog.
 * @returns {object[]} widgets
 */
app.get("/widgets", (req, res) => {
  const { limit = 10 } = req.query;
  res.json({ widgets: [], limit });
});

// Fetch a single widget by id.
app.get("/widgets/:id", (req, res) => {
  res.json({ id: req.params.id });
});

/** Create a widget. */
app.post("/widgets", (req, res) => {
  const { name, price = 0 } = req.body;
  res.status(201).json({ name, price });
});

app.put("/widgets/:id", updateWidget);

/** Permanently remove a widget. */
app.delete("/widgets/:id", (req, res) => {
  res.status(204).end();
});

// Looks like a write, but sends email — must be classified destructive.
app.post("/widgets/:id/notify", (req, res) => {
  sendEmail(req.body.recipient);
  res.json({ ok: true });
});

/** Replace every field of a widget. */
function updateWidget(req, res) {
  const { name, active } = req.body;
  res.json({ name, active });
}

function sendEmail() {}

// Not a route: config getter with no handler.
app.get("view engine");

app.listen(3000);
