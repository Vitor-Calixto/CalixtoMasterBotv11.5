module.exports = {
    apps : [{
      name   : "calixto-omnisystem",
      script : "./index.js",
      instances : 1,          // <--- MUDANÇA AQUI: Apenas 1 Piloto
      exec_mode : "fork",     // <--- MUDANÇA AQUI: Modo Fork é mais estável para Single Instance
      watch  : false,
      max_memory_restart : "1G",
      env: {
        NODE_ENV: "production",
        PORT: 3000
      },
      error_file: "./logs/err.log",
      out_file: "./logs/out.log",
      time: true
    }]
  }