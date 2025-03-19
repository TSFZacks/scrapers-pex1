/* eslint-disable */
const { chromium } = require('playwright');

function initializeFinalData(titleMappings) {
  const finalData = {};

  titleMappings.forEach(mapping => {
    if (mapping.structure === 'object') {
      finalData[mapping.title] = {};
      Object.values(mapping.keys).forEach(fieldName => {
        finalData[mapping.title][fieldName] = '';
      });
    } else if (mapping.structure === 'array') {
      finalData[mapping.title] = [];
    }
  });
  return finalData;
}

function findIdentityField(line, titleMappings) {
  const identityMapping = titleMappings.find(m => m.title === 'Identity');
  if (!identityMapping) return null;

  return Object.entries(identityMapping.keys).find(([prefix]) => {
    const token = prefix + ':';
    return line.includes(token);
  });
}

function parseLineForKeys(line, keys) {
  const result = {};

  for (const [prefix, fieldName] of Object.entries(keys)) {
    if (line.includes(prefix)) {

      const parts = line.split(prefix);
      if (parts[1]) {
        result[fieldName] = parts[1].trim().replace(/^[:\s]+/, '');
      } else {
        result[fieldName] = '';
      }
    }
  }
  return result;
}

async function processDocument(text, titleMappings) {
  const engaged = 'CASADO';
  const single = 'SOLTEIRO';

  const finalData = initializeFinalData(titleMappings);
  if (!finalData.Identity) {
    finalData.Identity = {};
  }
  if (!finalData.Representatives) {
    finalData.Representatives = [];
  }

  const lines = text
    .split('\n')
    .map(line => line.trim())
    .filter(Boolean);

  lines.forEach(line => {
    const found = findIdentityField(line, titleMappings);
    if (found) {
      const [prefix, fieldName] = found;
      const token = prefix + ':';
      const value = line.split(token)[1].trim();
      finalData.Identity[fieldName] = value;
      return;
    }

    if (line.match(/\d+º/) && (line.includes(single) || line.includes(engaged))) {
      const repData = parseLineForKeys(line, titleMappings.find(m => m.title === 'Representatives').keys);

      if (line.includes(single)) {
        repData.situation = single;
      } else if (line.includes(engaged)) {
        repData.situation = engaged;
      }

      finalData.Representatives.push(repData);
    }
  });

  return finalData;
}

async function scrapeData(page, url) {

  await page.goto(url);
  await page.click('a.btn.btn-ms.registar');

  await page.waitForTimeout(60000);

  const frameLocator = page.frameLocator('iframe').first();

  await frameLocator.locator('div[style="width: 95%;"]').waitFor();

  const documentText = await frameLocator.locator('div[style="width: 95%;"]').innerText();

  return documentText;
}

async function main() {

  console.log(`${new Date().toLocaleString()} - Starting Angola scraper.`);

  const titleMappings = [
    {
      title: 'Identity',
      keys: {
        'Matrícula': 'registration_number',
        'Firma': 'name',
        'NIF': 'vatin',
        'SEDE': 'address',
        'OBJECTO': 'business_purpose',
        'CAPITAL': 'capital',
        'GERÊNCIA': 'management',
        'FORMA DE OBRIGAR': 'binding_form',
      },
    },
    {
      title: 'Representatives',
      keys: {
        'Nome': 'name',
        'nacionalidade': 'nationality',
        'valor nominal de': 'quota',
        'SITUAÇÃO': 'situation',
      },
    },
    {
      title: 'Persons with significant control',
      keys: [],
    },
    {
      title: 'Establishments',
      keys: [
        {
          'Establishment type': 'establishment_type',
          'Start date': 'establishment_start_date',
          'SIRET': 'siret_number',
          'Trade name': 'trade_name',
          'Brand': 'brand',
          'APE code': 'ape_code',
          'APE description': 'ape_description',
          'Establishment nature': 'establishment_nature',
          'Main activity': 'main_activity',
          'Address': 'address',
          'Fund origin': 'fund_origin',
          'Establishment closed on': 'closure_date'
        }
      ],
    },
    {
      title: 'Charges',
      keys: [
        {
          'Charge ID': 'charge_id',
          'Charge Creation Date': 'charge_creation_date',
          'Charge Modification Date': 'charge_modification_date',
          'Charge Closure Date': 'charge_closure_date',
          'Assets Under Charge': 'assets_under_charge',
          'Amount': 'amount',
          'Charge Holder': 'charge_holder'
        }
      ],
    },
    {
      title: 'Observations',
      keys: [
        {
          'Date': 'date',
          'Description': 'description'
        }
      ],
    },
  ];

  const vatin = '5000090417';
  const url = `https://gue.gov.ao/portal/publicacao?empresa=${vatin}&nome=&ndi=&telefone=`;

  let browser;

  try {
    browser = await chromium.launch({ headless: true });
    const context = await browser.newContext();
    const page = await context.newPage();

    const documentText = await scrapeData(page, url);
    const structuredData = await processDocument(documentText, titleMappings);

    console.log(JSON.stringify(structuredData, null, 2));

    console.log(`${new Date().toLocaleString()} - Completed Angola scraper.`);
  } catch (error) {
    console.error(`${new Date().toLocaleString()} - Error:`, error);
  } finally {

    if (browser) {
      await browser.close();
    }
  }
}

main();
