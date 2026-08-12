import express from "express";
import "dotenv/config";
import { logger } from "./logger.js";
import { connectDB } from "./db/pool.js";
import { ordersRouter } from "./routes/orders.routes.js";
import { notFoundHandler, errorHandler } from "./middleware/errorHandler.js";
import { registerShutdownHandlers, setServer } from "./shutdown.js";

const app = express();
const port = Number(process.env.PORT ?? 3000);

app.use(express.json());

app.get("/health", (_req, res) => {
  res.json({ status: "ok" });
});

app.use(ordersRouter);

app.use(notFoundHandler);
app.use(errorHandler);

registerShutdownHandlers();

async function bootstrap() {
  try {
    await connectDB();
    setServer(
      app.listen(port, () => {
        logger.info(`Server listening on port ${port}`);
      }),
    );
  } catch (error) {
    logger.error(error, "Failed to start");
    process.exit(1);
  }
}

bootstrap();
