require('dotenv').config();
const express = require('express');
const cors = require('cors');
const contentRoutes = require('./routes/content');

const app = express();
const PORT = process.env.PORT || 3000;

app.use(cors());
app.use(express.json());

app.use('/api', contentRoutes);

app.get('/health', (req, res) => {
  res.json({ status: 'ok' });
});

app.listen(PORT, () => {
  console.log(`Server running on http://localhost:${PORT}`);
  console.log(`Merchant Address: ${process.env.MERCHANT_ADDRESS}`);
  console.log(`Facilitator URL: ${process.env.FACILITATOR_URL}`);
});
