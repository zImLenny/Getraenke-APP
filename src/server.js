const { createApp } = require('./app');

const port = Number(process.env.PORT) || 3000;

const app = createApp({
  dbFile: process.env.DB_FILE,
  registrationCode: process.env.REGISTRATION_CODE,
  secureCookies: process.env.SECURE_COOKIES === 'true',
  adminUsername: process.env.ADMIN_USERNAME,
  adminPassword: process.env.ADMIN_PASSWORD,
});

app.listen(port, () => {
  console.log(`Getränke-App läuft auf http://localhost:${port}`);
});
