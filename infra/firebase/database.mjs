// Retired: never load the previous staging credentials or connect to its database.
console.error("Retired: SISKOP uses private PostgreSQL on Contabo. Migrations run through the coordinated main release; see infra/contabo/siskop/README.md.");
process.exitCode = 1;
