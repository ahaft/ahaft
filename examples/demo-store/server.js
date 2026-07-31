// demo-store: a deliberately tiny Express app for trying out ahaft.
// All data lives in memory — restart to reset.
const express = require("express");

const app = express();
app.use(express.json());

let nextId = 4;
const products = [
  { id: 1, name: "Hammer", price: 19.99, hidden: false },
  { id: 2, name: "Screwdriver", price: 7.49, hidden: false },
  { id: 3, name: "Wrench", price: 12.0, hidden: false },
];

/**
 * List products. Hidden products are excluded unless ?includeHidden=true.
 */
app.get("/products", (req, res) => {
  const includeHidden = req.query.includeHidden === "true";
  res.json(products.filter((p) => includeHidden || !p.hidden));
});

/**
 * Get a single product by id.
 */
app.get("/products/:id", (req, res) => {
  const product = products.find((p) => p.id === Number(req.params.id));
  if (!product) return res.status(404).json({ error: "product not found" });
  res.json(product);
});

/**
 * Create a product. Requires a name; price defaults to 0.
 */
app.post("/products", (req, res) => {
  const { name, price = 0 } = req.body;
  if (!name) return res.status(400).json({ error: "name is required" });
  const product = { id: nextId++, name, price, hidden: false };
  products.push(product);
  res.status(201).json(product);
});

/**
 * Update a product's fields. Supports { hidden: true } to hide it from the
 * default listing.
 */
app.patch("/products/:id", (req, res) => {
  const product = products.find((p) => p.id === Number(req.params.id));
  if (!product) return res.status(404).json({ error: "product not found" });
  const { name, price, hidden } = req.body;
  if (name !== undefined) product.name = name;
  if (price !== undefined) product.price = price;
  if (hidden !== undefined) product.hidden = hidden;
  res.json(product);
});

/**
 * Delete a product permanently.
 */
app.delete("/products/:id", (req, res) => {
  const index = products.findIndex((p) => p.id === Number(req.params.id));
  if (index === -1) return res.status(404).json({ error: "product not found" });
  products.splice(index, 1);
  res.status(204).end();
});

const port = Number(process.env.PORT ?? 3000);
app.listen(port, () => {
  console.log(`demo-store listening on http://localhost:${port}`);
});
