// setup variables
const cors = require("cors");
const express = require("express");
const fs = require("fs");

const path = require("path");
const multer = require("multer");
const { Client } = require("pg");

const app = express();

const storage = multer.memoryStorage();
const PORT = 3001;
const upload = multer({ dest: "uploads/" });

app.use(cors());

// setup database
const dbConfig = {
  user: "postgres",
  // host: "127.0.0.1",
  host: "postgres.railway.internal",
  // password: "12345678",
  password: "MYsZWzarNwEXJuswIofWyzbERQKfnvbI",
  port: 5432,
  database: "VSIM_DB",
};

async function setupDatabase() {
  const defaultClient = new Client({ ...dbConfig, database: "postgres" });
  try {
    await defaultClient.connect();
    console.log("Connected to PostgreSQL default database.");

    const checkDbQuery = `
            SELECT 1 
            FROM pg_database 
            WHERE datname = 'VSIM_DB';
        `;
    const result = await defaultClient.query(checkDbQuery);

    if (result.rowCount === 0) {
      const createDbQuery = 'CREATE DATABASE "VSIM_DB";';
      await defaultClient.query(createDbQuery);
      console.log('Database "VSIM_DB" created successfully.');
    } else {
      console.log('Database "VSIM_DB" already exists.');
    }
  } catch (error) {
    console.error("Error ensuring database:", error.message);
  } finally {
    await defaultClient.end();
  }

  const client = new Client(dbConfig);
  try {
    await client.connect();
    console.log("Connected to PostgreSQL VSIM_DB database.");

    const createTableSimulation_DataQuery = `
            CREATE TABLE IF NOT EXISTS "Simulation_Data" (
                "ID" SERIAL PRIMARY KEY, 
                "DATA" TEXT NOT NULL,
                "DATE" DATE DEFAULT CURRENT_DATE,
                "TIME" TIME(0) DEFAULT CURRENT_TIME(0)
            );
        `;
    await client.query(createTableSimulation_DataQuery);
    console.log('Table "Simulation_Data" ensured to exist.');

    const createTableUserQuery = `
            CREATE TABLE IF NOT EXISTS "User" (
                "ID" SERIAL PRIMARY KEY, 
                "Name" VARCHAR(255) NOT NULL,
                "Position" VARCHAR(255) NOT NULL
            );
        `;
    await client.query(createTableUserQuery);
    console.log('Table "User" ensured to exist.');
  } catch (error) {
    console.error("Error setting up database:", error.message);
  } finally {
    await client.end();
  }
}

setupDatabase();

// setup api
app.post("/Results", upload.single("File"), async (req, res) => {
  if (!req.file) {
    return res.status(400).json({ error: "No file uploaded" });
  }

  const filePath = path.join(__dirname, req.file.path);

  try {
    const fileContent = fs.readFileSync(filePath, "utf-8");
    const jsonData = JSON.parse(fileContent);

    const client = new Client(dbConfig);
    await client.connect();

    const insertQuery = `
      INSERT INTO "Simulation_Data" ("DATA")
      VALUES ($1)
      RETURNING *;
    `;

    const result = await client.query(insertQuery, [JSON.stringify(jsonData)]);
    await client.end();

    fs.unlinkSync(filePath);
    res
      .status(200)
      .json({ message: "Data inserted successfully", data: result.rows[0] });
  } catch (error) {
    console.error("Error processing file:", error.message);
    res.status(500).json({ error: "Internal server error" });
  }
});

app.get("/Results", async (req, res) => {
  const client = new Client(dbConfig);

  try {
    await client.connect();

    const query = `
          SELECT "DATA" 
          FROM "Simulation_Data" 
          ORDER BY "DATE" DESC, "TIME" DESC 
          LIMIT 1;
      `;
    const result = await client.query(query);

    if (result.rows.length === 0) {
      return res.status(404).json({ message: "No data found" });
    }

    const json = result.rows[0].DATA;

    if (!json) {
      return res.status(500).json({ message: "Error decrypting data" });
    }

    res.json(json);
  } catch (error) {
    console.error("Error fetching latest result:", error.message);
    res.status(500).json({ error: "Internal Server Error" });
  } finally {
    await client.end();
  }
});

// start the server
app.listen(PORT, (error) => {
  if (!error)
    console.log(
      "Server is Successfully Running, and App is listening on port " + PORT
    );
  else console.log("Error occurred, server can't start", error);
});
