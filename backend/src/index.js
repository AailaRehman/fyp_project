import { env } from "./config/env.js";
import { connectDB } from "./config/db.js";
import { createApp } from "./app.js";

try {
  await connectDB();
} catch (e) {
  console.error("Could not connect to MongoDB:", e.message);
  console.error("Is it running? Try: docker compose up -d");
  process.exit(1);
}
createApp().listen(env.PORT, () => console.log(`Server on http://localhost:${env.PORT}`));
