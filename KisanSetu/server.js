const express = require('express');
const cors = require('cors');
const path = require('path');
require('dotenv').config(); 

// Import your database connection
// const connectDB = require('./config/db'); // Decommissioned SQLite

// Import Routes
// const authRoutes = require('./routes/authRoutes'); // Auth handled by Supabase direct-to-client
const produceRoutes = require('./routes/produceRoutes');
const equipmentRoutes = require('./routes/equipmentRoutes'); 

const app = express();
const PORT = process.env.PORT || 3000;

// Middleware
app.use(express.json({ limit: '10mb' })); 
app.use(express.urlencoded({ limit: '10mb', extended: true }));
app.use(cors());
app.use(express.static(path.join(__dirname, 'Frontend')));

// Mount Routes
// app.use('/api/auth', authRoutes); // Decommissioned
app.use('/api/produce', produceRoutes);
app.use('/api/equipment', equipmentRoutes); 

// Expose safe config to frontend (To prevent committing API keys to GitHub)
app.get('/api/config/gemini', (req, res) => {
    // Only send the key if requested (still not perfect security, but keeps it out of GitHub)
    res.json({ apiKey: process.env.GEMINI_API_KEY });
}); 

// Start the Server locally (Conditional for Vercel)
if (process.env.NODE_ENV !== 'production') {
    const server = app.listen(PORT, () => {
        console.log(`🚀 KisanSetu Backend running on http://localhost:${PORT}`);
        console.log(`🔗 Connected to Supabase Cloud for Data & Auth.`);
    });

    server.on('error', (err) => {
        if (err.code === 'EADDRINUSE') {
            const nextPort = parseInt(PORT) + 1;
            console.log(`⚠️ Port ${PORT} is busy, automatically trying port ${nextPort}...`);
            app.listen(nextPort, () => {
                console.log(`🚀 KisanSetu Backend started on fallback port: http://localhost:${nextPort}`);
            });
        } else {
            console.error("Server Error:", err);
        }
    });
}

// Export for Vercel Serverless
module.exports = app;
