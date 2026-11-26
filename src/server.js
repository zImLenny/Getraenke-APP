const { createApp } = require('./app');

const port = Number(process.env.PORT) || 3000;

createApp({
  dbUrl: process.env.DATABASE_URL || (process.env.DB_FILE && 'file:' + process.env.DB_FILE),
  dbAuthToken: process.env.DATABASE_AUTH_TOKEN,
  registrationCode: process.env.REGISTRATION_CODE,
  secureCookies: process.env.SECURE_COOKIES === 'true',
  adminUsername: process.env.ADMIN_USERNAME,
  adminPassword: process.env.ADMIN_PASSWORD,
  trustProxy: process.env.TRUST_PROXY,
}).then((app) => {
  app.listen(port, () => console.log(`Getränke-App läuft auf http://localhost:${port}`));
});
