require("dotenv").config();

const { runMailDiagnostics } = require("../services/mail.service");

runMailDiagnostics()
  .then(() => {
    console.log("SMTP diagnostic finished");
    process.exit(0);
  })
  .catch(() => {
    console.log("SMTP diagnostic failed");
    process.exit(1);
  });
