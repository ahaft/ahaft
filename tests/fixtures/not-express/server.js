const fastify = require("fastify")();

fastify.get("/things", async () => ({ things: [] }));

fastify.listen({ port: 3000 });
