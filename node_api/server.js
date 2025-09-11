import express from 'express';
import cors from 'cors';
import bodyParser from 'body-parser';
import { run } from './scraper.js'; // Assuming your CLI logic is moved to scraper.js

const app = express();
const port = process.env.PORT || 3001;

app.use(cors());
app.use(bodyParser.json());

app.get('/', (req, res) => {
  res.send('API is up');
});

app.post('/scrape', async (req, res) => {
  const { companyName } = req.body;

  if (!companyName) {
    return res.status(400).json({ error: 'Missing companyName' });
  }

  try {
    const result = await run(companyName, false); // don’t save file
    res.json(result);
  } catch (err) {
    console.error('Scraping failed:', err);
    res.status(500).json({ error: 'Scraping failed' });
  }
});

app.listen(port, () => {
  console.log(`✅ Node.js API running on port ${port}`);
});
