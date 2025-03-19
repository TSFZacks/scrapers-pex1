/* eslint-disable */
const { chromium } = require('playwright');

const TITLE_MAPPINGS = [
    {
        title: "Identity",
        keys: {
        'Ondernemingsnummer': 'registration_number',
        'Status': 'status',
        'Rechtstoestand': 'legal_status',
        'Type entiteit': 'entity_type',
        'Rechtsvorm': 'legal_form',
        'Begindatum': 'start_date',
        'Naam': 'name',
        'Naam in het Frans': 'name_french',
        'Adres van de zetel': 'headquarters_address',
        'Telefoonnummer': 'phone_number',
        'Faxnummer': 'fax_number',
        'E-mail': 'email',
        'Webadres': 'website',
        'Sinds': 'since',
            'Afkorting': 'abbreviation',
            'Kapitaal': 'capital',
            'Jaarvergadering': 'annual_meeting',
            'Einddatum boekjaar': 'end_of_fiscal_year'
        }
    },
    {
        title: "Establishments",
        keys: {
        'Nummer van de vestigingseenheid': 'unit_number',
        'Status van de vestigingseenheid': 'unit_status',
        'Naam van de vestigingseenheid': 'unit_name',
        'Adres van de vestigingseenheid': 'unit_address',
        'Aantal vestigingseenheden (VE)': 'number_of_units'
        }
    },
    {
        title: "Functions",
        keys: {
        'Bestuurder': 'director',
        'Vaste vertegenwoordiger': 'permanent_representative',
        'Persoon belast met dagelijks bestuur': 'person_in_charge_of_daily_management',
        'Gedelegeerd bestuurder': 'delegated_director',
        'Er zijn': 'number_of_function_holders'
        }
    },
    {
        title: "Authorizations",
        keys: {
        'Toelatingen': 'authorizations'
    }
}
];

async function scrapeData(page, url) {
    await page.goto(url, {
        waitUntil: 'networkidle',
        timeout: 30000
    });

    await page.waitForTimeout(3000);

    // Access establishments fpage
    const pageEstablishments = page.locator('//td[@colspan="2"]/a');
    await pageEstablishments.click();
    await page.waitForTimeout(2000);

    // Check if single or multiple establishments
    let singleEstablishmentFound = false;
    try {
        await page.locator('//div/h1').waitFor({ timeout: 2000 });
        singleEstablishmentFound = true;
    } catch (err) {
        singleEstablishmentFound = false;
    }

    const establishmentsData = [];

    if (singleEstablishmentFound) {
        const rawText = await page.locator('//tbody').innerText();
        establishmentsData.push(parseEstablishmentData(rawText));
    } else {
        const rows = await page.$$('//tbody//tr');
        for (const row of rows) {
            const cells = await row.$$('td');
            if (cells.length > 1) {
                const values = await Promise.all(cells.map(cell => cell.innerText()));
                const establishment = {
                    'status': values[1] ? values[1].trim() : null,
                    'unit_number': values[2] ? values[2].trim() : null,
                    'start_date': values[3] ? values[3].trim() : null,
                    'unit_name': values[4] ? values[4].trim() : null,
                    'unit_address': values[5] ? values[5].trim() : null
                };
                establishmentsData.push(establishment);
            }
        }
        
    }

    await page.goBack();

    // Expand functions section
    try {
        const buttonFunction = page.locator('//a[@onclick="return butFunct_onclick(\'toon\')"]');
        await buttonFunction.scrollIntoViewIfNeeded();
        await page.waitForTimeout(1000);
        await buttonFunction.click();
    } catch (error) {
        // If element not found, continue
    }

    // Expand activities section
    try {
        const buttonActivity = page.locator('//span[@id="klikbtw"]');
        await buttonActivity.scrollIntoViewIfNeeded();
        await page.waitForTimeout(1000);
        await buttonActivity.click();

        await page.evaluate(() => {
            window.scrollTo({ top: 0, behavior: 'smooth' });
        });
        await page.waitForTimeout(1000);
    } catch (error) {
        // If element not found, continue
    }

    // Get main data
    const mainData = await extractMainData(page);
    mainData.Establishments = establishmentsData;

    return mainData;
}

async function parseEstablishmentDataMoreLength(tbodies) {
  const establishment = {
      'status': null,
      'unit_number': null,
      'start_date': null,
      'unit_name': null,
      'unit_address': null
  };

    
    for (const tbody of tbodies) {
        const rows = await tbody.$$('tr');
        
        for (const row of rows) {
            const cells = await row.$$('td');
            console.log(cells)
            if (cells.length > 1) {
                const values = await Promise.all(cells.map(cell => cell.innerText()));
                // Skip first cell (index 0) as it contains labels
                if (values[1]) establishment.status = values[1].trim();
                if (values[2]) establishment.unit_number = values[2].trim();
                if (values[3]) establishment.start_date = values[3].trim();
                if (values[4]) establishment.unit_name = values[4].trim();
                if (values[5]) establishment.unit_address = values[4].trim();
            }
  }
}
  return establishment;

}

function parseEstablishmentData(rawText) {
    const lines = rawText.split('\n');
    const establishment = {};
    
    for (let i = 0; i < lines.length; i += 2) {
        if (lines[i] && lines[i + 1]) {
            const key = lines[i].trim();
            const value = lines[i + 1].trim();
            establishment[key] = value;
        }
    }
    
    return establishment;
}

async function extractMainData(page) {
    const extractedData = {};
    
    for (const section of TITLE_MAPPINGS) {
        extractedData[section.title] = {};
    }

    const tbodies = await page.$$('//tbody');
    
    for (const tbody of tbodies) {
        const rows = await tbody.$$('tr');
        
        for (const row of rows) {
            const cells = await row.$$('td');
            
            if (cells.length === 1) {
                const text = await cells[0].innerText();
                const key = text.split(':')[0].trim();
                
                for (const section of TITLE_MAPPINGS) {
                    if (section.keys[key]) {
                        extractedData[section.title][section.keys[key]] = '';
                    }
                }
            } else if (cells.length >= 2) {
                const key = (await cells[0].innerText()).split(':')[0].trim();
                const value = await cells[1].innerText();
                
                for (const section of TITLE_MAPPINGS) {
                    if (section.keys[key]) {
                        if (section.title === 'Functions') {
                            const detail = cells.length > 2 ? await cells[2].innerText() : '';
                            const entry = { "name/number": value, "data": detail };
                            
                            if (!extractedData[section.title][section.keys[key]]) {
                                extractedData[section.title][section.keys[key]] = [];
                            }
                            
                            if (!extractedData[section.title][section.keys[key]].some(
                                item => item["name/number"] === entry["name/number"] && item.data === entry.data
                            )) {
                                extractedData[section.title][section.keys[key]].push(entry);
                            }
                        } else {
                            extractedData[section.title][section.keys[key]] = value;
                        }
                    }
                }
            }
        }
    }

    // Add default message for empty sections
    for (const section in extractedData) {
        if (Object.keys(extractedData[section]).length === 0) {
            extractedData[section] = "No data included in CBE.";
        }
    }

    return extractedData;
}

async function main() {
    console.log(`${new Date().toLocaleString()} - Starting Belgium scraper.`);

    const vatin = '0402206045';
    const url = `https://kbopub.economie.fgov.be/kbopub/zoeknummerform.html?nummer=${vatin}&actionLu=Search`;
    
    let browser;

    try {
        browser = await chromium.launch({ headless: false });
        const context = await browser.newContext();
        const page = await context.newPage();

        const data = await scrapeData(page, url);
        console.log(JSON.stringify(data, null, 2));

        console.log(`${new Date().toLocaleString()} - Completed Belgium scraper.`);
    } catch (error) {
        console.error(`${new Date().toLocaleString()} - Error:`, error);
    } finally {
        if (browser) {
            await browser.close();
        }
    }
}

main();
