module.exports = {
  apps: [
    {
      name: "orders-backend",
      script: "dist/server.js",
      instances: 1,
      autorestart: true,
    },
  ],
};
