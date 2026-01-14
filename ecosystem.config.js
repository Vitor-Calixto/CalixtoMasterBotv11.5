module.exports = {
  apps : [
    // 1. O CÉREBRO (Redis)
    {
      name: "redis-server",
      script: "F:\\redis\\redis-server.exe", // Caminho onde você instalou
      args: "--bind 127.0.0.1",              // Força o IP local para não dar erro de bind
      instances: 1,
      autorestart: true,
      watch: false
    },
    // 2. O CORPO (Seu Bot)
    {
      name: "calixto-bot",
      script: "./index.js",
      instances: 1,
      autorestart: true,
      watch: false, // Deixei false para evitar reinícios indesejados ao criar arquivos de log
      env: {
        NODE_ENV: "production",
        // Garante que o bot saiba onde buscar o Redis, caso precise
        REDIS_HOST: "127.0.0.1",
        REDIS_PORT: "6379"
      }
    }
  ]
};