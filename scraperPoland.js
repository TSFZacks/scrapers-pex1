/* eslint-disable */
const axios = require('axios');
const fs = require('fs');

/**
 * Mapeamento principal das chaves
 */
const titleMappings = [
  {
    title: 'Identity',
    keys: {
      'odpis.dane.dzial1.danePodmiotu.nazwa': 'name',
      'odpis.dane.dzial1.danePodmiotu.identyfikatory.nip': 'vatin',
      'company_type': 'company_type',
      'odpis.dane.dzial1.danePodmiotu.formaPrawna': 'legal_form',

      // Mapeia as atividades
      'odpis.dane.dzial3.przedmiotDzialalnosci.przedmiotPrzewazajacejDzialalnosci[]': 'main_activity_array',
      'odpis.dane.dzial3.przedmiotDzialalnosci.przedmiotPozostalejDzialalnosci[]': 'secondary_activities_array',

      'business_purpose': 'business_purpose',
      'odpis.rodzaj': 'status',
      'odpis.naglowekA.dataRejestracjiWKRS': 'foundation_year',
      'odpis.dane.dzial1.siedzibaIAdres.adres': 'address',
      'employees': 'employees',
      'odpis.dane.dzial1.kapital.wysokoscKapitaluZakladowego.wartosc': 'capital',
      'phone': 'phone',
      'odpis.dane.dzial1.siedzibaIAdres.adresPocztyElektronicznej': 'email',
      'odpis.dane.dzial1.siedzibaIAdres.adresStronyInternetowej': 'websites',
      'odpis.dane.dzial3.informacjaODniuKonczacymRokObrotowy.dzienKonczacyPierwszyRokObrotowy': 'fiscal_period',
      'document_responsible': 'registration_responsible',
      'document_date': 'document_date',
    },
  },
  {
    title: 'Representatives',
    keys: [
      {
        // Mapeando os vários campos do array "sklad[]"
        'odpis.dane.dzial2.reprezentacja.sklad[].nazwisko.nazwiskoICzlon': 'last_name',
        'odpis.dane.dzial2.reprezentacja.sklad[].imiona.imie': 'first_name',
        // Em vez de guardar em 'vatin', vamos salvar diretamente em 'pesel'
        'odpis.dane.dzial2.reprezentacja.sklad[].identyfikator.pesel': 'vatin',
        'odpis.dane.dzial2.reprezentacja.sklad[].funkcjaWOrganie': 'role',

        // "czyZawieszona" iremos usar para derivar "status"
        'odpis.dane.dzial2.reprezentacja.sklad[].czyZawieszona': 'temp_suspended',

        'quota': 'quota',
        'Status': 'status',          // (do seu schema original)
        'Appointed on': 'start',
        'Resigned on': 'end',
        'Date of birth': 'birthday',
        'Correspondence address': 'address',
        'Nationality': 'nationality',
        'Occupation': 'occupation',
        'Marital status': 'marital_status',
        'Spouse name': 'spouse_name',
        'Property regime': 'property_regime',
        'other_directorships': []
      },
    ],
  },
  {
    title: 'Persons with significant control',
    keys: []
  },
  {
    title: 'Establishments',
    keys: [
      {
        'odpis.dane.dzial1.jednostkiTerenoweOddzialy[].nazwa': 'name',
        'nip': 'vatin',
        'type': 'type',
        'start': 'start',
        'status': 'status',
        'natural_form': 'natural_form',
        'Activité principale': 'main_activity',
        'odpis.dane.dzial1.jednostkiTerenoweOddzialy[].adres': 'address',
        'ISICs': [
        ]
      },
    ],
  },
  {
    title: 'Charges',
    keys: []
  },
  {
    title: 'Observations',
    keys: []
  },
];

// -- Funções auxiliares --

function flattenMappingKeys(keys) {
  let pairs = [];
  if (Array.isArray(keys)) {
    for (const subMap of keys) {
      pairs.push(...Object.entries(subMap));
    }
  } else if (keys) {
    pairs = Object.entries(keys);
  }
  return pairs;
}

function fillMissingKeys(finalData, keys, isArrayTitle) {
  const pairs = flattenMappingKeys(keys);
  if (isArrayTitle && Array.isArray(finalData)) {
    finalData.forEach((item) => fillOneItem(item, pairs));
  } else {
    fillOneItem(finalData, pairs);
  }
}

function fillOneItem(itemObj, pairs) {
  if (!itemObj || typeof itemObj !== 'object') return;

  for (const [sourceKey, tKey] of pairs) {
    if (typeof tKey === 'string') {
      // já existente: se for string e não tiver a prop, põe null
      if (!Object.prototype.hasOwnProperty.call(itemObj, tKey)) {
        itemObj[tKey] = null;
      }
    } else if (Array.isArray(tKey)) {
      // (A) se tKey for array mas VAZIO => forçamos itemObj[sourceKey] = []
      if (tKey.length === 0) {
        if (!Object.prototype.hasOwnProperty.call(itemObj, sourceKey)) {
          itemObj[sourceKey] = [];
        }
      }
      // (B) se tKey[0] for string => sua lógica atual
      else if (typeof tKey[0] === 'string') {
        const fieldName = tKey[0];
        if (!Object.prototype.hasOwnProperty.call(itemObj, fieldName)) {
          itemObj[fieldName] = [];
        }
      }
    }
  }
}


function parseBracketPath(sourcePath) {
  if (sourcePath.endsWith('[]')) {
    return [sourcePath.slice(0, -2), ''];
  } else if (sourcePath.includes('[].')) {
    return sourcePath.split('[].');
  }
  return [sourcePath, null];
}

function assignValue(sectionObj, targetKey, rawValue) {
  sectionObj[targetKey] = (rawValue === undefined ? null : rawValue);
}

function getNestedValue(obj, path) {
  if (!obj || typeof path !== 'string') return undefined;
  const parts = path.split('.');
  let current = obj;
  for (const part of parts) {
    if (!current || typeof current !== 'object') return undefined;
    const match = part.match(/^([^\[]+)\[(\d+)\]$/);
    if (match) {
      const propName = match[1];
      const index = parseInt(match[2], 10);
      if (!Array.isArray(current[propName])) return undefined;
      if (index < 0 || index >= current[propName].length) return undefined;
      current = current[propName][index];
    } else {
      if (!(part in current)) return undefined;
      current = current[part];
    }
  }
  return current;
}

function mapKrsData(krsData, mappings) {
  const finalResult = {};
  // Forçamos que do segundo título em diante sejam arrays
  const forceArrayTitles = mappings.map(mapping => mapping.title).slice(1);

  for (const { title, keys } of mappings) {
    const isArrayTitle = forceArrayTitles.includes(title);
    finalResult[title] = isArrayTitle ? [] : {};

    if (!keys) continue;

    // "sectionResult" é o rascunho com os valores
    const sectionResult = isArrayTitle ? [{}] : {};

    // Passo 1: Mapeamento
    const flatPairs = flattenMappingKeys(keys);
    for (const [sourcePath, targetKey] of flatPairs) {
      const [arrayPath, subPath] = parseBracketPath(sourcePath);
      if (subPath !== null) {
        // ex.: "xxx[].yyy"
        const arrayValue = getNestedValue(krsData, arrayPath);
        if (Array.isArray(arrayValue)) {
          if (!sectionResult[targetKey]) {
            sectionResult[targetKey] = [];
          }
          arrayValue.forEach((item, idx) => {
            if (subPath === '') {
              // "xxx[]"
              sectionResult[targetKey][idx] = item;
            } else {
              // "xxx[].yyy"
              if (!sectionResult[targetKey][idx]) {
                sectionResult[targetKey][idx] = {};
              }
              const subVal = getNestedValue(item, subPath);
              sectionResult[targetKey][idx][subPath] = (subVal !== undefined ? subVal : null);
            }
          });
        } else {
          sectionResult[targetKey] = [];
        }
      } else {
        const val = getNestedValue(krsData, sourcePath);
        assignValue(sectionResult, targetKey, val);
      }
    }

    // Passo 2: Pós-processamento

    if (title === 'Representatives') {
      const finalArray = [];
      const {
        last_name,
        first_name,
        vatin,         // <- Agora armazenado em 'pesel'
        role,
        temp_suspended,
      } = sectionResult;

      if (
        Array.isArray(last_name) &&
        Array.isArray(first_name) &&
        last_name.length === first_name.length
      ) {
        for (let i = 0; i < last_name.length; i++) {
          const ln = last_name[i]?.['nazwisko.nazwiskoICzlon'] || '';
          const fn = first_name[i]?.['imiona.imie'] || '';
          const pe = vatin?.[i]?.['identyfikator.pesel'] || null;  // extrai o PESEL real

          const rl = role?.[i]?.['funkcjaWOrganie'] || null;
          const suspendedFlag = temp_suspended?.[i]?.['czyZawieszona'];

          // Define "status" => se "czyZawieszona" === true => "active", senão "inactive"
          let computedStatus = (suspendedFlag === true) ? 'active' : 'inactive';

          finalArray.push({
            full_name: `${fn} ${ln}`.trim(),
            vatin: pe,      // se a API retornar "6**********", você verá esse valor aqui
            role: rl,
            status: computedStatus,
          });
        }
      }

      // Remove chaves temporárias
      delete sectionResult.last_name;
      delete sectionResult.first_name;
      delete sectionResult.vatin;
      delete sectionResult.role;
      delete sectionResult.temp_suspended;

      finalResult[title] = finalArray;
    }

    else if (title === 'Establishments') {
      const arrName = sectionResult.name || [];
      const arrAddr = sectionResult.address || [];
      const finalArr = [];

      const n = Math.max(arrName.length, arrAddr.length);
      for (let i = 0; i < n; i++) {
        const nameObj = arrName[i] || {};
        const addressObj = arrAddr[i] || {};

        const nameVal = nameObj['nazwa'] || '';
        let addrString = '';

        if (typeof addressObj === 'object' && addressObj !== null) {
          const real = addressObj.adres || {};
          const {
            ulica = '',
            nrDomu = '',
            miejscowosc = '',
            poczta = '',
            kraj = '',
            kodPocztowy = '',
          } = real;

          addrString = [ulica, nrDomu, miejscowosc, poczta, kraj, kodPocztowy]
            .map(x => x.trim())
            .filter(Boolean)
            .join(', ');
        }

        finalArr.push({
          name: nameVal,
          address: addrString || '',
        });
      }

      delete sectionResult.name;
      delete sectionResult.address;
      finalResult[title] = finalArr;
    }

    else if (title === 'Identity') {
      const main = sectionResult.main_activity_array || [];
      const sec = sectionResult.secondary_activities_array || [];
      const isics = [];

      // Consolida atividades
      const mainArr = Array.isArray(main) ? main : [main];
      mainArr.forEach((it) => {
        if (!it || typeof it !== 'object') return;
        const opis = it.opis || '';
        const d = it.kodDzial || '';
        const k = it.kodKlasa || '';
        const p = it.kodPodklasa || '';
        const code = [d, k, p].filter(Boolean).join('.');
        if (opis || code) {
          isics.push({ code: code || null, description: opis || null });
        }
      });

      const secArr = Array.isArray(sec) ? sec : [sec];
      secArr.forEach((it) => {
        if (!it || typeof it !== 'object') return;
        const opis = it.opis || '';
        const d = it.kodDzial || '';
        const k = it.kodKlasa || '';
        const p = it.kodPodklasa || '';
        const code = [d, k, p].filter(Boolean).join('.');
        if (opis || code) {
          isics.push({ code: code || null, description: opis || null });
        }
      });

      sectionResult.ISICs = isics;
      delete sectionResult.main_activity_array;
      delete sectionResult.secondary_activities_array;

      // Endereço principal
      if (sectionResult.address && typeof sectionResult.address === 'object') {
        const {
          ulica = '',
          nrDomu = '',
          miejscowosc = '',
          poczta = '',
          kraj = '',
          kodPocztowy = '',
        } = sectionResult.address;
        const merged = [ulica, nrDomu, miejscowosc, poczta, kraj, kodPocztowy]
          .map(x => x.trim())
          .filter(Boolean)
          .join(', ');
        sectionResult.address = merged;
      }

      // websites => array
      if (typeof sectionResult.websites === 'string') {
        sectionResult.websites = [sectionResult.websites];
      } else if (!sectionResult.websites) {
        sectionResult.websites = [];
      } else if (!Array.isArray(sectionResult.websites)) {
        sectionResult.websites = [String(sectionResult.websites)];
      }

      finalResult[title] = sectionResult;
    }

    else {
      // Se não for Representatives/Establishments/Identity
      if (isArrayTitle) {
        const onlyObj = sectionResult[0];
        const allNull = Object.values(onlyObj).every(
          (val) =>
            val === null ||
            (Array.isArray(val) && val.length === 0) ||
            (typeof val === 'object' && Object.keys(val).length === 0)
        );
        finalResult[title] = allNull ? [] : [onlyObj];
      } else {
        finalResult[title] = sectionResult;
      }
    }

    // Passo 3: Preenche chaves faltantes
    fillMissingKeys(finalResult[title], keys, isArrayTitle);

    // Remove arrays internos do Identity (se tiver ficado) 
    console.log(title);
    if (title === 'Identity') {
      delete finalResult[title].main_activity_array;
      delete finalResult[title].secondary_activities_array;
    } 
    if (title === 'Representatives') {
      finalResult[title].forEach((rep) => {
        delete rep.last_name;
        delete rep.first_name;
        delete rep.temp_suspended;
      });
    }
  }

  return finalResult;
}

async function getOdpisAktualny(krs) {

  const url = `https://api-krs.ms.gov.pl/api/krs/OdpisAktualny/${krs}?rejestr=P&format=json`;

  try {
    const response = await axios.get(url);
    console.log('Status:', response.status);

    const rawData = response.data;
    const structuredData = mapKrsData(rawData, titleMappings);

    console.log(JSON.stringify(structuredData, null, 2));
    console.log('Arquivo "translatedData.json" criado com o mapeamento.');
  } catch (error) {
    if (error.response) {
      console.error('Erro de resposta da API:', error.response.status, error.response.data);
    } else {
      console.error('Erro de requisição:', error.message);
    }
  }
}

// Exemplo de uso
getOdpisAktualny('0000271562');

const vatins = ['0000026438', '0000009831', '0000059492', '0000023302', '0000051749', '0000271562']
