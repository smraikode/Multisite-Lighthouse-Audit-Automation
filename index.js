const express = require('express');
const fs = require('fs');
const path = require('path');
const uuidv1 = require('uuid/v1');
const { BigQuery } = require('@google-cloud/bigquery');
const lighthouse = require('lighthouse');
const puppeteer = require('puppeteer');
const dotenv = require('dotenv');
const constants = require('./constants');
const { getConfigForAuditing } = require('./config');
const { createJSON } = require('./createJson');

const app = express();

// Load environment variables from .env file
dotenv.config();

// Configuration
const projectId = process.env.PROJECT_ID;
const datasetId = process.env.DATASET_ID;
const tableId = process.env.TABLE_ID;
const isMobile = process.env.IS_MOBILE === 'true'; // Set isMobile based on environment variable

async function runLighthouseAudit() {
  const lighthouseOptions = {
    output: 'json',
    logLevel: 'error',
    port: 9222,
    chromeFlags: ['--headless', '--disable-dev-shm-usage']
  };

  const websites = constants.websites;

  if (!websites || !Array.isArray(websites) || websites.length === 0) {
    console.error('Invalid websites configuration');
    return;
  }

  const deviceType = isMobile ? 'mobile' : 'desktop';
  const uuid = uuidv1();
  const results = [];

  for (const website of websites) {
    const config = getConfigForAuditing(website, isMobile);
    const browser = await puppeteer.launch();
    const page = await browser.newPage();
    const { lhr } = await lighthouse(website, {
      ...lighthouseOptions,
      port: new URL(browser.wsEndpoint()).port,
      output: 'json',
    }, config);
    await browser.close();
    lhrFinal = createJSON(lhr, website, deviceType, uuid);

    if (process.env.NODE_ENV === 'production') {
      // Save Cloud Function results in BigQuery
      try {
        const bigquery = new BigQuery({ projectId });
        await bigquery.dataset(datasetId).table(tableId).insert(lhrFinal, {'ignoreUnknownValues':true, 'raw':false});

        console.log(`Results saved in BigQuery.`);
        console.log(`Lighthouse audits completed for ${website}.`);
      } catch (err)
      {
        console.log(err.errors[0].errors);
      }
    }

    results.push({
      ...lhrFinal
    });
  }

  // Save local results in a JSON file
  if (process.env.NODE_ENV !== 'production') {
    const timestamp = new Date().toISOString();
    const filename = `temp/lighthouse-results-${deviceType}-${timestamp}.json`;
    const filePath = path.join(__dirname, filename);

    fs.writeFileSync(filePath, JSON.stringify(results, null, 2));

    console.log(`Local Lighthouse audits completed for ${deviceType}. Results saved in: ${filePath}`);
  }
}

app.get('/', (req, res) => {
  runLighthouseAudit()
    .then(() => {
      res.sendStatus(204);
    })
    .catch((error) => {
      console.error('Error running Lighthouse audits:', error);
      res.sendStatus(500);
    });
});

if (process.env.NODE_ENV !== 'production') {
  const port = process.env.PORT || 8080;
  app.listen(port, () => {
    console.log(`Server is listening on port ${port}`);
  });
}

module.exports = { app };
