import express from "express";
import "dotenv/config";
import { logger } from "./logger.js";
import { connectDB } from "./db/pool.js";

const app = express();
const port = Number(process.env.PORT ?? 3000);

app.use(express.json());

app.get("/health", (_req, res) => {
  res.json({ status: "ok" });
});

async function bootstrap() {
  try {
    await connectDB();
    app.listen(port, () => {
      logger.info(`Server listening on port ${port}`);
    });
  } catch (error) {
    logger.error(error, "Failed to start");
    process.exit(1);
  }
}

bootstrap();
