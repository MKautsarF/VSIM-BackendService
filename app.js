// setup variables
const cors = require("cors");
const express = require("express");
const fs = require("fs");

const path = require("path");
const multer = require("multer");
const { Client } = require("pg");

const app = express();

// Improved storage configuration with error handling
const storage = multer.diskStorage({
    destination: function (req, file, cb) {
        // Create uploads directory if it doesn't exist
        const dir = path.join(__dirname, "uploads");
        if (!fs.existsSync(dir)) {
            fs.mkdirSync(dir, { recursive: true });
        }
        cb(null, "uploads/");
    },
    filename: function (req, file, cb) {
        cb(null, file.fieldname + "-" + Date.now() + path.extname(file.originalname));
    }
});

const PORT = process.env.PORT || 3001;
const upload = multer({ storage: storage });

app.use(cors());
app.use(express.json());

// Database configuration
const dbConfig = process.env.DATABASE_URL
    ? {
        connectionString: process.env.DATABASE_URL,
    }
    : {
        user: "postgres",
        host: "postgres.railway.internal",
        //host: "127.0.0.1",
        password: "MYsZWzarNwEXJuswIofWyzbERQKfnvbI",
        //password: "12345678",
        port: 5432,
        database: "VSIM_DB",
    };

async function setupDatabase() {
    const client = new Client(dbConfig);
    try {
        await client.connect();
        console.log("Connected to PostgreSQL database.");

        // Ensure Simulation_Data table exists
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

        // Ensure User table exists
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

// DATABASE CHECK ENDPOINT - NEW
app.get("/check-db", async (req, res) => {
    const client = new Client(dbConfig);

    try {
        await client.connect();
        console.log("Connected to database for health check");

        const result = await client.query('SELECT NOW() as time');
        res.json({
            status: "Database connected",
            timestamp: result.rows[0].time,
            database: dbConfig.database || "Using connection string"
        });
    } catch (error) {
        console.error("Database connection error:", error.message);
        res.status(500).json({
            error: "Database connection failed",
            details: error.message
        });
    } finally {
        await client.end();
    }
});

// DATA CHECK ENDPOINT - NEW
app.get("/check-data", async (req, res) => {
    const client = new Client(dbConfig);

    try {
        await client.connect();
        console.log("Connected to database for data check");

        // Query to count rows
        const countQuery = `SELECT COUNT(*) FROM "Simulation_Data";`;
        const countResult = await client.query(countQuery);
        const count = parseInt(countResult.rows[0].count);

        // Query to get sample data (limited to 5 rows to avoid large responses)
        const dataQuery = `
      SELECT "ID", "DATE", "TIME", 
             CASE 
               WHEN LENGTH("DATA") > 100 THEN SUBSTRING("DATA", 1, 100) || '...' 
               ELSE "DATA" 
             END as "DATA_SAMPLE"
      FROM "Simulation_Data" 
      ORDER BY "DATE" DESC, "TIME" DESC 
      LIMIT 5;
    `;
        const dataResult = await client.query(dataQuery);

        res.json({
            count: count,
            message: count > 0 ? "Data found in table" : "No data in table",
            sampleData: dataResult.rows
        });

    } catch (error) {
        console.error("Error checking data:", error.message);
        res.status(500).json({ error: "Database error", details: error.message });
    } finally {
        await client.end();
    }
});

// TEST UPLOAD ENDPOINT - NEW
app.post("/test-upload", upload.single("File"), (req, res) => {
    console.log("/test-upload route hit!");
    console.log("Request body:", req.body);

    if (!req.file) {
        console.log("No file received.");
        return res.status(400).json({ error: "No file uploaded" });
    }

    console.log("File details:", {
        filename: req.file.filename,
        originalName: req.file.originalname,
        path: req.file.path,
        size: req.file.size
    });

    return res.status(200).json({
        message: "File received successfully",
        fileDetails: {
            filename: req.file.filename,
            originalName: req.file.originalname,
            size: req.file.size
        }
    });
});

// RESULTS POST ENDPOINT
app.post("/Results", upload.single("File"), async (req, res) => {
    console.log("/Results POST route hit!");
    console.log("Request headers:", req.headers);
    console.log("Request body keys:", Object.keys(req.body));

    if (!req.file) {
        console.log("No file received.");
        return res.status(400).json({ error: "No file uploaded" });
    }

    console.log("File received:", req.file.originalname);
    const filePath = path.join(__dirname, req.file.path);

    try {
        console.log("Reading file from:", filePath);
        const fileContent = fs.readFileSync(filePath, "utf-8");
        console.log("File content (first 100 chars):", fileContent.substring(0, 100));

        let jsonData;
        try {
            jsonData = JSON.parse(fileContent);
            console.log("JSON parsed successfully");
        } catch (parseError) {
            console.error("JSON parse error:", parseError.message);
            return res.status(400).json({
                error: "Invalid JSON in uploaded file",
                details: parseError.message
            });
        }

        const client = new Client(dbConfig);
        try {
            await client.connect();
            console.log("Connected to database for insertion");

            const insertQuery = `
        INSERT INTO "Simulation_Data" ("DATA")
        VALUES ($1)
        RETURNING "ID", "DATE", "TIME";
      `;

            const result = await client.query(insertQuery, [JSON.stringify(jsonData)]);
            console.log("Data inserted successfully:", result.rows[0]);

            // Clean up the file
            fs.unlinkSync(filePath);

            res.status(200).json({
                message: "Data inserted successfully",
                data: result.rows[0]
            });
        } catch (dbError) {
            console.error("Database error:", dbError.message);
            res.status(500).json({
                error: "Database error",
                details: dbError.message
            });
        } finally {
            await client.end();
        }
    } catch (error) {
        console.error("Error processing file:", error.message);
        console.error("Error stack:", error.stack);
        res.status(500).json({
            error: "Internal server error",
            details: error.message
        });
    }
});

// RESULTS GET ENDPOINT
app.get("/Results", async (req, res) => {
    console.log("/Results GET route hit!");
    const client = new Client(dbConfig);

    try {
        await client.connect();
        console.log("Connected to database for data retrieval");

        const query = `
      SELECT "ID", "DATA", "DATE", "TIME" 
      FROM "Simulation_Data" 
      ORDER BY "DATE" DESC, "TIME" DESC 
      LIMIT 1;
    `;
        const result = await client.query(query);

        if (result.rows.length === 0) {
            console.log("No data found in database");
            return res.status(404).json({ message: "No data found" });
        }

        console.log("Data found, ID:", result.rows[0].ID);
        const json = result.rows[0].DATA;

        if (!json) {
            console.log("Data field is empty");
            return res.status(500).json({ message: "Error retrieving data" });
        }

        // Parse JSON before sending if it's a string
        let responseData;
        try {
            responseData = typeof json === 'string' ? JSON.parse(json) : json;
        } catch (error) {
            console.error("Error parsing stored JSON:", error.message);
            return res.status(500).json({ message: "Error parsing stored data" });
        }

        res.json(responseData);
    } catch (error) {
        console.error("Full error:", error);
        console.error("Error stack:", error.stack);
        res.status(500).json({ error: error.message });
    } finally {
        await client.end();
    }
});

// STATUS CHECK
app.get("/", (req, res) => {
    res.send("Server is up! Backend is alive!");
});


// start the server
app.listen(PORT, "0.0.0.0", (error) => {
    console.log("ENV PORT:", process.env.PORT);
    if (!error) {
        console.log("Server is Successfully Running, and App is listening on port " + PORT);
        console.log("Available routes:");
        console.log("- GET /check-db: Check database connection");
        console.log("- GET /check-data: Check data in Simulation_Data table");
        console.log("- POST /test-upload: Test file upload functionality");
        console.log("- GET /Results: Get latest simulation data");
        console.log("- POST /Results: Upload new simulation data");
    } else {
        console.log("Error occurred, server can't start", error);
    }
});