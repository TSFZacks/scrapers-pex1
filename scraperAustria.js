/* eslint-disable */
const axios = require('axios');
const fs = require('fs');

async function getVersion() {
  try {
    const elementsUrl = 'https://www.wirtschaft.at/';
    const response = await axios.get(elementsUrl, {
      headers: { 'Accept': '*/*' },
    });
    const htmlContent = response.data;

    const versionMatch = htmlContent.match(/\d{4}\.\d{3}\.\d+/);
    if (!versionMatch) {
      throw new Error('Version not found in the HTML');
    }
    return versionMatch[0];
  } catch (error) {
    console.error('Error getting version:', error);
    throw error;
  }
}

async function getData(url) {
  try {
    const response = await axios.get(url, {
      headers: { 'Accept': '*/*' },
    });
    return response.data;
  } catch (error) {
    console.error('Error getting data:', error);
    throw error;
  }
}

function getNestedValue(obj, path) {
  if (!obj) return undefined;
  const parts = path.split('.');
  let current = obj;

  for (const part of parts) {

    const matchArr = part.match(/(\w+)\[(\d+)\]/);
    if (matchArr) {
      const prop = matchArr[1];
      const index = parseInt(matchArr[2], 10);
      if (!current[prop] || !Array.isArray(current[prop])) {
        return undefined;
      }
      current = current[prop][index];
    } else {
      if (current[part] === undefined) {
        return undefined;
      }
      current = current[part];
    }
  }
  return current;
}

function assignValue(finalObject, targetKey, rawValue) {

  const value = (rawValue === undefined) ? null : rawValue;

  if (Array.isArray(targetKey)) {

    if (targetKey.length === 1 && typeof targetKey[0] === 'string') {

      const realKey = targetKey[0];
      if (!value) {
        finalObject[realKey] = [];
      } else if (Array.isArray(value)) {
        finalObject[realKey] = value;
      } else {
        finalObject[realKey] = [];
      }
    } else if (
      targetKey.length === 2 &&
      typeof targetKey[0] === 'string' &&
      typeof targetKey[1] === 'object'
    ) {

      const realKey = targetKey[0];
      const subMapping = targetKey[1];
      if (!value) {
        finalObject[realKey] = [];
      } else if (Array.isArray(value)) {

        finalObject[realKey] = value.map((elem) => {
          const mappedObj = {};
          for (const [src, tgt] of Object.entries(subMapping)) {
            mappedObj[tgt] = (elem && elem[src] !== undefined) ? elem[src] : null;
          }
          return mappedObj;
        });
      } else if (typeof value === 'object') {

        const singleObj = {};
        for (const [src, tgt] of Object.entries(subMapping)) {
          singleObj[tgt] = (value[src] !== undefined) ? value[src] : null;
        }
        finalObject[realKey] = [ singleObj ];
      } else {
        finalObject[realKey] = [];
      }
    }

    return;
  }

  if (typeof targetKey === 'string') {

    finalObject[targetKey] = value;
    return;
  }
}

async function mapDocument(text, mappings) {

  const forceArrayTitles = [
    'Persons with significant control',
    'Establishments',
    'Charges',
    'Observations'
  ];
  

  try {
    const data = (typeof text === 'string') ? JSON.parse(text) : text;
    const companyData = (data.pageProps && data.pageProps.unternehmen) || {};

    const finalData = {};

    for (const mapping of mappings) {
      const isArrayTitle = forceArrayTitles.includes(mapping.title);

      if (isArrayTitle) {
        finalData[mapping.title] = [];
      } else {
        finalData[mapping.title] = {};
      }

      if (mapping.keys) {

        if (Array.isArray(mapping.keys)) {

          const singleObj = {};
          mapping.keys.forEach((objKeys) => {
            for (const [sourceKey, targetKey] of Object.entries(objKeys)) {
              const foundVal = getNestedValue(companyData, sourceKey);
              assignValue(singleObj, targetKey, foundVal);
            }
          });
          if (isArrayTitle) {
            finalData[mapping.title].push(singleObj);
          } else {
            Object.assign(finalData[mapping.title], singleObj);
          }
        } else {

          const singleObj = {};
          for (const [sourceKey, targetKey] of Object.entries(mapping.keys)) {
            const foundVal = getNestedValue(companyData, sourceKey);
            assignValue(singleObj, targetKey, foundVal);
          }
          if (isArrayTitle) {
            finalData[mapping.title].push(singleObj);
          } else {
            Object.assign(finalData[mapping.title], singleObj);
          }
        }
      }

      if (mapping.title === 'Representatives' && mapping.itemKeys) {
        const arr = getNestedValue(companyData, 'leitungsorgane.items');
        let repsArray = [];
        if (Array.isArray(arr)) {
          repsArray = arr.map((repItem) => {
            const obj = {};
            for (const [sourceKey, targetKey] of Object.entries(mapping.itemKeys)) {
              const rawVal = getNestedValue(repItem, sourceKey);
              assignValue(obj, targetKey, rawVal);
            }
            return obj;
          });
        }

        finalData[mapping.title] = repsArray;
      }
    }

    const ownershipList = [];
    const netzwerk = companyData.netzwerk || {};
    for (const dateKey of Object.keys(netzwerk)) {
      const sub = netzwerk[dateKey];
      if (!sub || typeof sub !== 'object') continue;

      if (Array.isArray(sub.gesellschafter)) {
        sub.gesellschafter.forEach((item) => {
          const shareObj = {
            share_percentage: item.anteil,
            capital_amount: (item.kapital && item.kapital.menge),
            owner_name: (item.ref && item.ref.name),
          };
          ownershipList.push(shareObj);
        });
      }
    }

    finalData.Ownership = ownershipList;

    const reps = Array.isArray(finalData.Representatives) ? finalData.Representatives : [];
    const owners = finalData.Ownership || [];
    owners.forEach((owner) => {
      const { owner_name, capital_amount } = owner;
      if (!owner_name) return;
      let matchedRep = reps.find(
        (r) => r.name === owner_name || r.representative_name === owner_name
      );
      if (!matchedRep) {
        matchedRep = {};
        reps.push(matchedRep);
      }
      matchedRep.name = owner_name || null;
      matchedRep.quota = (capital_amount === undefined) ? null : capital_amount;
    });
    delete finalData.Ownership;
    finalData.Representatives = reps;

    for (const tKey of forceArrayTitles) {
      if (Array.isArray(finalData[tKey]) && finalData[tKey].length === 1) {
        const onlyObj = finalData[tKey][0];

        const allNull = Object.values(onlyObj).every(
          (val) => val === null || (Array.isArray(val) && val.length === 0)
        );
        if (allNull) {
          finalData[tKey] = [];
        }
      }
    }

    return finalData;
  } catch (error) {
    console.error('Error mapping document:', error);
    throw error;
  }
}

async function main() {
  console.log(`${new Date().toLocaleString()} - Starting Austria scraper.`);

  const titleMappings = [
    {
      title: 'Identity',
      keys: {
        'name': 'name',
        'fbNr': 'vatin',
        'type': 'company_type',
        'rechtsform.bezeichnung': 'legal_form',
        'main_activity': 'main_activity',
        'geschäftszweige': 'business_purpose',
        'status': 'status',
        'eintragungsdatum': 'foundation_year',
        'adresse.full': 'address',
        'employees': 'employees',
        'unternehmenswertanteil': 'capital',
        'phone': 'phone',
        'email': 'email',
        'webseiten': ['websites'],
        'stichtagKab': 'fiscal_period',
        'Document responsible': 'registration_responsible',
        'Document date': 'document_date',
        'ISICs': [
          'ISICs',
          { 'code': 'code', 'description': 'description' }
        ]
      },
    },
    {
      title: 'Representatives',
      itemKeys: {
        'ref.name': 'name',
        'funktion': 'role',
        'DIN': 'vatin',
        'Quota': 'quota',
        'Status': 'status',
        'Appointment Date': 'start',
        'Cessation': 'end',
        'Data de nascimento': 'birthday',
        'Residência/Sede': 'address',
        'Nacionalidade': 'nationality',
        'Ocupação': 'occupation',
        'Estado civil': 'marital_status',
        'Nome do cônjuge': 'spouse_name',
        'Regime de bens': 'property_regime',
        'other_directorships': [
          'other_directorships',
          {
            'Name': 'name',
            'Registration number': 'vatin',
            'Role': 'role',
            'Start': 'start',
            'End': 'end'
          }
        ]
      },
    },
    {
      title: 'Persons with significant control',
      keys: [
        {
          'Natural person': {
            'Name': 'name',
            'Correspondence address': 'address',
            'Notified on': 'start',
            'Ceased on': 'end',
            'Date of birth': 'birthday',
            'Nationality': 'nationality',
            'Country of residence': 'residence_country',
            'Nature of control': 'natureOfControl'
          },
          'Legal person': {
            'Name': 'name',
            'Correspondence address': 'address',
            'Notified on': 'start',
            'Ceased on': 'end',
            'Governing law': 'governing_law',
            'Legal form': 'legal_form',
            'Place registered': 'place_registered',
            'Registration number': 'registration_number',
            'Incorporated in': 'incorporated_in',
            'Nature of control': 'natureOfControl'
          }
        }
      ]
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
      ]
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
      ]
    },
    {
      title: 'Observations',
      keys: [
        {
          'Date': 'date',
          'Description': 'description'
        }
      ]
    }
  ];

  const vatin = '000024k';

  try {
    const version = await getVersion();
    const url = `https://www.wirtschaft.at/_next/data/${version}/de/u/${vatin}.json?id=${vatin}`;
    const documentText = await getData(url);

    const structuredData = await mapDocument(documentText, titleMappings);

    console.log(JSON.stringify(structuredData, null, 2));
    fs.writeFileSync('output.json', JSON.stringify(documentText, null, 2), 'utf-8');

    console.log(`${new Date().toLocaleString()} - Completed Austria scraper.`);
  } catch (error) {
    console.error(`${new Date().toLocaleString()} - Error:`, error);
  }
}

// 8) Chamando main()
const vatins = ['646071f', '621582t', '530753w', '380598d', '621386d', '492370z'];
main();
